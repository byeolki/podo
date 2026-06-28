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

  getCacheKey(sourceId: string, format: string, bitrate: number, seekMs: number): string {
    const segmentMs = Math.floor(seekMs / 30000) * 30000;
    return crypto.createHash('sha256')
      .update(`${sourceId}:${format}:${bitrate}:${segmentMs}`)
      .digest('hex')
      .slice(0, 32);
  }

  getCachePath(key: string): string {
    return path.join(this.cacheDir, `${key}.ts`);
  }

  has(key: string): boolean {
    const p = this.getCachePath(key);
    return fs.existsSync(p);
  }

  async markWritten(key: string): Promise<void> {
    const filePath = this.getCachePath(key);
    try {
      const stat = fs.statSync(filePath);
      this.entries.set(key, { filePath, createdAt: Date.now(), size: stat.size });
      await this.evictIfNeeded();
    } catch {}
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
        if (!file.endsWith('.ts')) continue;
        const filePath = path.join(this.cacheDir, file);
        const stat = fs.statSync(filePath);
        const key = file.replace('.ts', '');
        this.entries.set(key, { filePath, createdAt: stat.mtimeMs, size: stat.size });
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
