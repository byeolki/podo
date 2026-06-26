import { Injectable, Inject } from '@nestjs/common';
import { eq, desc, gte, and, sql } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { newId } from '../common/id';

@Injectable()
export class HistoryService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async record(dto: { userId: string; trackId: string; sourceId?: string; playedAt: Date; playedDuration: number }) {
    const id = newId();
    await this.db.insert(schema.play_history).values({
      id,
      user_id: dto.userId,
      track_id: dto.trackId,
      source_id: dto.sourceId ?? null,
      played_at: dto.playedAt,
      played_duration: dto.playedDuration,
    });
    return { id };
  }

  getRecent(userId: string, limit = 50) {
    return this.db
      .select()
      .from(schema.play_history)
      .where(eq(schema.play_history.user_id, userId))
      .orderBy(desc(schema.play_history.played_at))
      .limit(limit);
  }

  async getStats(userId: string, period: 'week' | 'month' | 'all') {
    const cutoff = this.getCutoff(period);
    const filter = cutoff
      ? and(eq(schema.play_history.user_id, userId), gte(schema.play_history.played_at, cutoff))
      : eq(schema.play_history.user_id, userId);

    const [totalDuration, topTracks] = await Promise.all([
      this.db
        .select({ total: sql<number>`sum(${schema.play_history.played_duration})` })
        .from(schema.play_history)
        .where(filter)
        .get(),
      this.db
        .select({
          track_id: schema.play_history.track_id,
          count: sql<number>`count(*)`,
          total_duration: sql<number>`sum(${schema.play_history.played_duration})`,
        })
        .from(schema.play_history)
        .where(filter)
        .groupBy(schema.play_history.track_id)
        .orderBy(desc(sql<number>`count(*)`))
        .limit(10),
    ]);

    return {
      period,
      total_listen_duration: totalDuration?.total ?? 0,
      top_tracks: topTracks,
    };
  }

  private getCutoff(period: string): Date | null {
    const now = Date.now();
    if (period === 'week') return new Date(now - 7 * 86400000);
    if (period === 'month') return new Date(now - 30 * 86400000);
    return null;
  }
}
