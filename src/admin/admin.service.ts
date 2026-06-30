import { Injectable, Inject, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { eq, and, isNull, sql, desc, gte, inArray } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { StreamingService } from '../streaming/streaming.service';
import { TranscodeCacheService } from '../streaming/transcode-cache.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly streaming: StreamingService,
    private readonly cache: TranscodeCacheService,
  ) {}

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
    const uploadDir = process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'data', 'uploads');
    const artworkDir = process.env.ARTWORK_DIR ?? path.join(process.cwd(), 'data', 'artwork');
    const cacheStats = this.cache.getCacheStats();

    return {
      upload_dir: { path: uploadDir, size_bytes: this.dirSize(uploadDir) },
      artwork_dir: { path: artworkDir, size_bytes: this.dirSize(artworkDir) },
      transcode_cache: { path: cacheStats.dir, size_bytes: cacheStats.size_bytes },
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

  async listAliases() {
    return this.db.select().from(schema.artist_aliases).orderBy(schema.artist_aliases.name);
  }

  async addAlias(name: string, alias: string) {
    const id = (await import('../common/id')).newId();
    try {
      await this.db.insert(schema.artist_aliases).values({ id, name: name.trim(), alias: alias.trim(), created_at: new Date() });
    } catch {
      throw new ConflictException('Alias pair already exists');
    }
    return { id, name, alias };
  }

  async removeAlias(id: string) {
    await this.db.delete(schema.artist_aliases).where(eq(schema.artist_aliases.id, id));
    return { deleted: true };
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
      uptime_seconds: process.uptime(),
      memory: process.memoryUsage(),
      tracks: dbCount,
      sources: sourceCount,
      users: userCount,
      node_version: process.version,
    };
  }

  private getCutoff(period: string): Date | null {
    const now = Date.now();
    if (period === 'day') return new Date(now - 86400000);
    if (period === 'week') return new Date(now - 7 * 86400000);
    if (period === 'month') return new Date(now - 30 * 86400000);
    return null;
  }

  private dirSize(dirPath: string): number {
    let total = 0;
    try {
      const walk = (p: string) => {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(p, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const full = path.join(p, e.name);
          if (e.isDirectory()) {
            walk(full);
          } else {
            try {
              total += fs.statSync(full).size;
            } catch {
              // skip inaccessible files
            }
          }
        }
      };
      walk(dirPath);
    } catch {
      // directory doesn't exist
    }
    return total;
  }
}
