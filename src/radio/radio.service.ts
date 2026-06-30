import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, and, notInArray, isNull, inArray, sql } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { newId } from '../common/id';

export interface RadioOptions {
  seedTrackId?: string;
  seedArtistName?: string;
  count?: number;
  excludeIds?: string[];
}

@Injectable()
export class RadioService {
  private readonly logger = new Logger(RadioService.name);

  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async getStation(opts: RadioOptions): Promise<typeof schema.tracks.$inferSelect[]> {
    const count = Math.min(opts.count ?? 50, 200);
    const excludeIds = opts.excludeIds ?? [];

    const seedArtistNames = await this.resolveSeedArtistNames(opts);
    const seedTagIds = await this.resolveSeedTags(opts);

    const scored: Array<{ track: typeof schema.tracks.$inferSelect; score: number }> = [];
    const seen = new Set<string>(excludeIds);

    const baseCond = and(
      isNull(schema.tracks.deleted_at),
      excludeIds.length ? notInArray(schema.tracks.id, excludeIds) : undefined,
    );

    if (seedArtistNames.length) {
      const likeConditions = seedArtistNames.map((n) =>
        sql`(lower(COALESCE(ov.artist, t.artist, '')) LIKE lower(${'%' + n + '%'})
          OR lower(COALESCE(ov.original_artist, '')) LIKE lower(${'%' + n + '%'}))`,
      );
      const rows = await this.db.all<typeof schema.tracks.$inferSelect>(sql`
        SELECT t.* FROM tracks t
        LEFT JOIN track_metadata_overrides ov ON ov.track_id = t.id
        WHERE t.deleted_at IS NULL
          AND (${sql.join(likeConditions, sql` OR `)})
          ${excludeIds.length ? sql`AND t.id NOT IN (${sql.join(excludeIds.map((id) => sql`${id}`), sql`,`)})` : sql``}
      `);
      for (const track of rows) {
        if (seen.has(track.id)) continue;
        seen.add(track.id);
        scored.push({ track, score: 3 + Math.random() });
      }
    }

    if (seedTagIds.length) {
      const rows = await this.db
        .select({ track: schema.tracks })
        .from(schema.tracks)
        .innerJoin(schema.track_tags, eq(schema.track_tags.track_id, schema.tracks.id))
        .where(and(baseCond, inArray(schema.track_tags.tag_id, seedTagIds)));

      for (const { track } of rows) {
        if (seen.has(track.id)) {
          const existing = scored.find((s) => s.track.id === track.id);
          if (existing) existing.score += 1;
          continue;
        }
        seen.add(track.id);
        scored.push({ track, score: 2 + Math.random() });
      }
    }

    if (scored.length < count) {
      const needed = count - scored.length;
      const randomRows = await this.db
        .select()
        .from(schema.tracks)
        .where(and(isNull(schema.tracks.deleted_at), seen.size ? notInArray(schema.tracks.id, [...seen]) : undefined))
        .orderBy(sql`RANDOM()`)
        .limit(needed);

      for (const track of randomRows) {
        scored.push({ track, score: Math.random() });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, count).map((s) => s.track);
  }

  async createMix(
    opts: RadioOptions & { name?: string; userId: string },
  ): Promise<typeof schema.playlists.$inferSelect> {
    const tracks = await this.getStation(opts);
    const id = newId();
    const name = opts.name ?? `Mix · ${new Date().toLocaleDateString()}`;

    await this.db.insert(schema.playlists).values({
      id,
      owner_user_id: opts.userId,
      name,
      description: 'Auto-generated mix',
      is_public: false,
    });

    if (tracks.length) {
      await this.db.insert(schema.playlist_tracks).values(
        tracks.map((t, i) => ({ playlist_id: id, track_id: t.id, position: i })),
      ).onConflictDoNothing();
    }

    this.logger.log(`Mix created: "${name}" (${tracks.length} tracks) for user=${opts.userId}`);
    return (await this.db.select().from(schema.playlists).where(eq(schema.playlists.id, id)).get())!;
  }

  private async resolveSeedArtistNames(opts: RadioOptions): Promise<string[]> {
    const names = new Set<string>();

    if (opts.seedArtistName) names.add(opts.seedArtistName);

    if (opts.seedTrackId) {
      const row = await this.db.all<{ artist: string | null; ov_artist: string | null }>(sql`
        SELECT t.artist, ov.artist as ov_artist FROM tracks t
        LEFT JOIN track_metadata_overrides ov ON ov.track_id = t.id
        WHERE t.id = ${opts.seedTrackId}
      `);
      const raw = row[0];
      const artistRaw = raw?.ov_artist ?? raw?.artist;
      if (artistRaw) {
        for (const n of artistRaw.split(',').map((s) => s.trim()).filter(Boolean)) names.add(n);
      }
    }

    return [...names];
  }

  private async resolveSeedTags(opts: RadioOptions): Promise<string[]> {
    if (!opts.seedTrackId) return [];

    const rows = await this.db
      .select({ tag_id: schema.track_tags.tag_id })
      .from(schema.track_tags)
      .where(eq(schema.track_tags.track_id, opts.seedTrackId));

    return rows.map((r) => r.tag_id);
  }
}
