import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and, isNull, sql, desc, gte, inArray } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { StreamingService } from '../streaming/streaming.service';
import { TranscodeCacheService } from '../streaming/transcode-cache.service';
import { ScannerService } from '../library/scanner.service';
import { AiService } from '../ai/ai.service';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly streaming: StreamingService,
    private readonly cache: TranscodeCacheService,
    private readonly config: ConfigService,
    private readonly scanner: ScannerService,
    private readonly ai: AiService,
  ) {}

  /**
   * Repairs track thumbnails across the whole library.
   *
   * Three things leave a track without a usable cover, and none of them heal on
   * their own: a thumbnail that was never generated, a `thumbnail_path` pointing
   * at a file that is no longer there, and — for anything imported before the
   * poster-frame change — an image extracted from frame 0, which for a video that
   * opens on a fade-in is a solid black rectangle.
   *
   * A normal rescan can't fix any of these for downloaded tracks, because yt-dlp
   * files live in the upload directory rather than under a library root.
   */
  async rebuildThumbnails() {
    const tracks = await this.db
      .select({ id: schema.tracks.id, thumbnail_path: schema.tracks.thumbnail_path })
      .from(schema.tracks)
      .where(isNull(schema.tracks.deleted_at));

    let rebuilt = 0;
    let blank = 0;
    let missing = 0;
    let absent = 0;
    const unfixable: string[] = [];

    for (const track of tracks) {
      let needsWork = false;
      if (!track.thumbnail_path) {
        absent++;
        needsWork = true;
      } else if (!fs.existsSync(track.thumbnail_path)) {
        missing++;
        needsWork = true;
      } else if (await this.scanner.isBlankImage(track.thumbnail_path)) {
        blank++;
        needsWork = true;
      }
      if (!needsWork) continue;

      if (await this.scanner.rebuildTrackThumbnail(track.id)) rebuilt++;
      else unfixable.push(track.id);
    }

    this.logger.log(
      `Thumbnail rebuild: ${rebuilt} regenerated (${blank} blank, ${missing} missing file, ${absent} never had one), ` +
      `${unfixable.length} have no local video to generate from`,
    );

    return {
      examined: tracks.length,
      rebuilt,
      blank,
      missing_file: missing,
      never_generated: absent,
      /// These have no video source on disk; re-fetching them from their source
      /// URL is the only way to get a cover.
      needs_refetch: unfixable.length,
      needs_refetch_track_ids: unfixable.slice(0, 200),
    };
  }

  async verifyLibraryIntegrity() {
    const sources = await this.db
      .select()
      .from(schema.sources)
      .where(and(eq(schema.sources.origin, 'local'), eq(schema.sources.available, true), isNull(schema.sources.deleted_at)));

    const missingIds: string[] = [];
    const missingFiles: string[] = [];

    for (const source of sources) {
      if (!fs.existsSync(source.locator)) {
        missingIds.push(source.id);
        missingFiles.push(source.locator);
      }
    }

    if (missingIds.length) {
      await this.db
        .update(schema.sources)
        .set({ available: false, updated_at: new Date() })
        .where(inArray(schema.sources.id, missingIds));
      this.logger.warn(`Integrity check: marked ${missingIds.length} sources unavailable`);
    }

    const orphanMeta = await this.db
      .select({ id: schema.track_metadata_overrides.track_id })
      .from(schema.track_metadata_overrides)
      .leftJoin(schema.tracks, eq(schema.track_metadata_overrides.track_id, schema.tracks.id))
      .where(isNull(schema.tracks.id));

    return {
      missing_files: missingFiles,
      missing_count: missingFiles.length,
      orphan_metadata_count: orphanMeta.length,
    };
  }

  async clearTranscodeCache() {
    const count = await this.cache.clearAll();
    this.logger.log(`Transcode cache cleared: ${count} entries`);
    return { cleared: count };
  }

  getCacheStats() {
    return this.cache.getCacheStats();
  }

  getActiveStreams() {
    return { active_session_ids: this.streaming.getActiveStreams() };
  }

  async getTrafficStats(period: 'day' | 'week' | 'month' | 'all') {
    const cutoff = this.getCutoff(period);
    const filter = cutoff ? gte(schema.stream_sessions.started_at, cutoff) : undefined;

    const [totalSessions, byUser] = await Promise.all([
      this.db
        .select({
          total: sql<number>`count(*)`,
          total_bytes: sql<number>`sum(${schema.stream_sessions.bytes_sent})`,
        })
        .from(schema.stream_sessions)
        .where(filter)
        .get(),
      this.db
        .select({
          user_id: schema.stream_sessions.user_id,
          count: sql<number>`count(*)`,
          bytes: sql<number>`sum(${schema.stream_sessions.bytes_sent})`,
        })
        .from(schema.stream_sessions)
        .where(filter)
        .groupBy(schema.stream_sessions.user_id)
        .orderBy(desc(sql<number>`sum(${schema.stream_sessions.bytes_sent})`))
        .limit(20),
    ]);

    return {
      period,
      total_sessions: totalSessions?.total ?? 0,
      total_bytes_sent: totalSessions?.total_bytes ?? 0,
      by_user: byUser,
      transcode_cache: this.cache.getCacheStats(),
    };
  }

  async getStorageBreakdown() {
    const uploadDir = this.config.get<string>('upload_dir', path.join(process.cwd(), 'data', 'uploads'));
    const artworkDir = this.config.get<string>('artwork_dir', path.join(process.cwd(), 'data', 'artwork'));
    const cacheStats = this.cache.getCacheStats();

    const [uploadSize, artworkSize] = await Promise.all([
      this.dirSize(uploadDir),
      this.dirSize(artworkDir),
    ]);

    return {
      upload_dir: { path: uploadDir, size_bytes: uploadSize },
      artwork_dir: { path: artworkDir, size_bytes: artworkSize },
      transcode_cache: { path: cacheStats.dir, size_bytes: cacheStats.size_bytes },
      disk: this.getDiskUsage(uploadDir),
    };
  }

  async listMappingQueue(status = 'pending') {
    return this.db
      .select()
      .from(schema.mapping_queue)
      .where(eq(schema.mapping_queue.status, status as 'pending' | 'approved' | 'rejected'));
  }

  async reviewMappingQueue(id: string, action: 'approve' | 'reject', reviewerId: string) {
    const entry = await this.db.select().from(schema.mapping_queue).where(eq(schema.mapping_queue.id, id)).get();
    if (!entry) throw new NotFoundException('Mapping queue entry not found');

    const status = action === 'approve' ? 'approved' : 'rejected';
    await this.db
      .update(schema.mapping_queue)
      .set({ status, reviewed_by: reviewerId, reviewed_at: new Date() })
      .where(eq(schema.mapping_queue.id, id));

    this.logger.log(`Mapping queue ${id}: ${action}d by ${reviewerId}`);
    return { id, status };
  }

  async listUsers() {
    return this.db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.users.role, created_at: schema.users.created_at })
      .from(schema.users);
  }

  async getSystemHealth() {
    const [dbCount, sourceCount, userCount] = await Promise.all([
      this.db.$count(schema.tracks),
      this.db.$count(schema.sources),
      this.db.$count(schema.users),
    ]);

    return {
      status: 'ok',
      version: this.config.get<string>('app_version', '0.0.0'),
      uptime_seconds: process.uptime(),
      memory: process.memoryUsage(),
      tracks: dbCount,
      sources: sourceCount,
      users: userCount,
      node_version: process.version,
      /// Whether `OPENAI_API_KEY` is set. Without it the metadata fill and the
      /// "AI Fill" action are silent no-ops, which is indistinguishable from them
      /// being broken — there was no way to tell from outside which it was.
      ai_enabled: this.ai.enabled,
      ai_model: this.ai.enabled ? this.config.get<string>('openai_model', 'gpt-4o-mini') : null,
    };
  }

  private getCutoff(period: string): Date | null {
    const now = Date.now();
    if (period === 'day') return new Date(now - 86400000);
    if (period === 'week') return new Date(now - 7 * 86400000);
    if (period === 'month') return new Date(now - 30 * 86400000);
    return null;
  }

  private getDiskUsage(targetPath: string): { total_bytes: number; free_bytes: number; used_bytes: number } {
    try {
      const output = execSync(`df -B1 "${targetPath}"`, { encoding: 'utf8' });
      const lines = output.trim().split('\n');
      const parts = lines[lines.length - 1].trim().split(/\s+/);
      const total_bytes = parseInt(parts[1], 10);
      const used_bytes = parseInt(parts[2], 10);
      const free_bytes = parseInt(parts[3], 10);
      return { total_bytes, free_bytes, used_bytes };
    } catch {
      return { total_bytes: 0, free_bytes: 0, used_bytes: 0 };
    }
  }

  /**
   * Async on purpose: an upload directory holding a real library is tens of
   * thousands of files, and walking it with the sync fs API blocks the event
   * loop — every other request, including in-flight audio streams, stalls until
   * it finishes.
   */
  private async dirSize(dirPath: string): Promise<number> {
    let total = 0;
    const walk = async (p: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(p, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(p, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else {
          try {
            total += (await fsp.stat(full)).size;
          } catch {
            // skip inaccessible files
          }
        }
      }
    };
    await walk(dirPath);
    return total;
  }
}
