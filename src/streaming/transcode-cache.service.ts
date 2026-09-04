import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

interface CacheEntry {
  filePath: string;
  createdAt: number;
  size: number;
}

const CACHE_EXT = '.ts';
const PENDING_EXT = '.part';

/**
 * Disk cache of finished transcode segments.
 *
 * Segments are written to a `.part` sibling and only renamed into place once
 * ffmpeg exits cleanly, so `has()` can never observe a half-written file: a
 * second request for the same key while the first is still transcoding simply
 * misses and transcodes its own copy, instead of streaming a truncated one.
 */
@Injectable()
export class TranscodeCacheService implements OnApplicationShutdown {
  private readonly logger = new Logger(TranscodeCacheService.name);
  private readonly cacheDir: string;
  private readonly maxSizeBytes: number;
  private entries = new Map<string, CacheEntry>();

  constructor(private readonly config: ConfigService) {
    this.cacheDir = config.get<string>('transcode_cache_dir', path.join(process.cwd(), 'data', 'transcode-cache'));
    this.maxSizeBytes = 2 * 1024 * 1024 * 1024;
    fs.mkdirSync(this.cacheDir, { recursive: true });
    this.loadExisting();
  }

  getCacheKey(sourceId: string, format: string, bitrate: number, seekMs: number, normalize?: boolean, manualVolumeDb?: number | null): string {
    const segmentMs = Math.floor(seekMs / 30000) * 30000;
    return crypto.createHash('sha256')
      .update(`${sourceId}:${format}:${bitrate}:${segmentMs}:${normalize ? '1' : '0'}:${manualVolumeDb ?? ''}`)
      .digest('hex')
      .slice(0, 32);
  }

  getCachePath(key: string): string {
    return path.join(this.cacheDir, `${key}${CACHE_EXT}`);
  }

  /** Scratch path a transcode writes to until it completes; see `commit`/`abort`. */
  getPendingPath(key: string): string {
    return path.join(this.cacheDir, `${key}${PENDING_EXT}`);
  }

  has(key: string): boolean {
    return fs.existsSync(this.getCachePath(key));
  }

  /** Publishes a completed `.part` file under its real key. */
  async commit(key: string): Promise<void> {
    const pendingPath = this.getPendingPath(key);
    const filePath = this.getCachePath(key);
    try {
      fs.renameSync(pendingPath, filePath);
      const stat = fs.statSync(filePath);
      this.entries.set(key, { filePath, createdAt: Date.now(), size: stat.size });
      await this.evictIfNeeded();
    } catch (e) {
      this.logger.warn(`Failed to commit cache entry ${key}: ${(e as Error).message}`);
      this.abort(key);
    }
  }

  /** Drops an aborted/failed transcode's scratch file. */
  abort(key: string): void {
    try { fs.unlinkSync(this.getPendingPath(key)); } catch {}
  }

  evict(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    try { fs.unlinkSync(entry.filePath); } catch {}
    this.entries.delete(key);
  }

  async clearAll(): Promise<number> {
    let count = 0;
    for (const entry of this.entries.values()) {
      try { fs.unlinkSync(entry.filePath); count++; } catch {}
    }
    this.entries.clear();
    return count;
  }

  getCacheStats() {
    let totalSize = 0;
    for (const entry of this.entries.values()) totalSize += entry.size;
    return { count: this.entries.size, size_bytes: totalSize, dir: this.cacheDir };
  }

  private loadExisting(): void {
    try {
      const files = fs.readdirSync(this.cacheDir);
      for (const file of files) {
        const filePath = path.join(this.cacheDir, file);
        // Anything still `.part` belongs to a transcode killed by a crash or
        // restart — it can never be completed now, so drop it.
        if (file.endsWith(PENDING_EXT)) {
          try { fs.unlinkSync(filePath); } catch {}
          continue;
        }
        if (!file.endsWith(CACHE_EXT)) continue;
        const stat = fs.statSync(filePath);
        this.entries.set(path.basename(file, CACHE_EXT), { filePath, createdAt: stat.mtimeMs, size: stat.size });
      }
      this.logger.log(`Loaded ${this.entries.size} cached segments`);
    } catch {}
  }

  private async evictIfNeeded(): Promise<void> {
    let totalSize = 0;
    for (const entry of this.entries.values()) totalSize += entry.size;

    if (totalSize <= this.maxSizeBytes) return;

    const sorted = [...this.entries.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);

    for (const [key, entry] of sorted) {
      if (totalSize <= this.maxSizeBytes * 0.8) break;
      try {
        fs.unlinkSync(entry.filePath);
        totalSize -= entry.size;
        this.entries.delete(key);
      } catch {}
    }
  }

  onApplicationShutdown() {}
}
