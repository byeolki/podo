import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, desc, gte, and, isNull, sql } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { newId } from '../common/id';

@Injectable()
export class HistoryService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async record(dto: { userId: string; trackId: string; sourceId?: string; playedAt: Date; playedDuration: number }) {
    const track = await this.db
      .select({ id: schema.tracks.id })
      .from(schema.tracks)
      .where(and(eq(schema.tracks.id, dto.trackId), isNull(schema.tracks.deleted_at)))
      .get();
    if (!track) throw new NotFoundException('Track not found');

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

  /**
   * Joined against the track (and its override layer) rather than returned as bare
   * `play_history` rows: a history list has nothing to render without a title, and
   * every client would otherwise have to re-fetch the whole library to resolve ids.
   *
   * Deleting a track doesn't delete the rows that recorded playing it, so the join
   * has to exclude them here. Without that, recently-played listed tracks that no
   * longer exist and every one of them 404'd the moment it was clicked.
   */
  getRecent(userId: string, limit = 50) {
    return this.db
      .select({
        id: schema.play_history.id,
        track_id: schema.play_history.track_id,
        source_id: schema.play_history.source_id,
        played_at: schema.play_history.played_at,
        played_duration: schema.play_history.played_duration,
        title: sql<string>`COALESCE(${schema.track_metadata_overrides.title}, ${schema.tracks.title})`,
        artist: sql<string | null>`COALESCE(${schema.track_metadata_overrides.artist}, ${schema.tracks.artist})`,
        album_version_id: schema.tracks.album_version_id,
        thumbnail_path: schema.tracks.thumbnail_path,
      })
      .from(schema.play_history)
      .innerJoin(schema.tracks, eq(schema.play_history.track_id, schema.tracks.id))
      .leftJoin(
        schema.track_metadata_overrides,
        eq(schema.track_metadata_overrides.track_id, schema.tracks.id),
      )
      .where(and(eq(schema.play_history.user_id, userId), isNull(schema.tracks.deleted_at)))
      .orderBy(desc(schema.play_history.played_at))
      .limit(limit);
  }

  async getStats(userId: string, period: 'week' | 'month' | 'all') {
    const cutoff = this.getCutoff(period);
    const filter = and(
      eq(schema.play_history.user_id, userId),
      ...(cutoff ? [gte(schema.play_history.played_at, cutoff)] : []),
    );
    // Same exclusion as getRecent: a deleted track must not turn up as one of your
    // top tracks. The total is left over the raw history — time you actually spent
    // listening doesn't stop having been spent because the file was removed later.
    const liveFilter = and(filter, isNull(schema.tracks.deleted_at));

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
        .innerJoin(schema.tracks, eq(schema.play_history.track_id, schema.tracks.id))
        .where(liveFilter)
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
