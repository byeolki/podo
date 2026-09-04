import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, and, notInArray, isNull, inArray, sql } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { newId } from '../common/id';
import { TracksService } from '../tracks/tracks.service';

/// SQLite caps how many bound parameters one statement may carry, and both the
/// caller-supplied `exclude` list and the running "already picked" set are
/// interpolated as parameters. Past this many, filtering moves to JS instead.
const MAX_SQL_EXCLUSIONS = 500;

export interface RadioOptions {
  seedTrackId?: string;
  seedArtistName?: string;
  count?: number;
  excludeIds?: string[];
}

@Injectable()
export class RadioService {
  private readonly logger = new Logger(RadioService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly tracksService: TracksService,
  ) {}

  async getStation(opts: RadioOptions) {
    const orderedIds = await this.getOrderedTrackIds(opts);
    const tracks = await this.tracksService.findByIds(orderedIds);
    const byId = new Map(tracks.map((t) => [t.id, t]));
    return orderedIds.map((id) => byId.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
  }

  private async getOrderedTrackIds(opts: RadioOptions): Promise<string[]> {
    const count = Math.min(opts.count ?? 50, 200);
    const excludeIds = (opts.excludeIds ?? []).slice(0, MAX_SQL_EXCLUSIONS);

    const seedArtistNames = await this.resolveSeedArtistNames(opts);
    const seedTagIds = await this.resolveSeedTags(opts);

    const scored: Array<{ track: typeof schema.tracks.$inferSelect; score: number }> = [];
    const scoredIndex = new Map<string, number>();
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
        scoredIndex.set(track.id, scored.length);
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
          // Already matched on artist: a genre match on top of that is a stronger
          // signal, so bump its score rather than adding a duplicate entry.
          const existingIndex = scoredIndex.get(track.id);
          if (existingIndex !== undefined) scored[existingIndex].score += 1;
          continue;
        }
        seen.add(track.id);
        scoredIndex.set(track.id, scored.length);
        scored.push({ track, score: 2 + Math.random() });
      }
    }

    if (scored.length < count) {
      const needed = count - scored.length;
      // A big seed can match thousands of tracks; excluding them all as bound
      // parameters would blow SQLite's statement limit, so past the threshold we
      // over-fetch and drop the duplicates here instead.
      const excludeInSql = seen.size > 0 && seen.size <= MAX_SQL_EXCLUSIONS;
      const randomRows = await this.db
        .select()
        .from(schema.tracks)
        .where(and(isNull(schema.tracks.deleted_at), excludeInSql ? notInArray(schema.tracks.id, [...seen]) : undefined))
        .orderBy(sql`RANDOM()`)
        .limit(excludeInSql ? needed : needed + seen.size);

      for (const track of randomRows) {
        if (seen.has(track.id)) continue;
        if (scored.length >= count) break;
        seen.add(track.id);
        scored.push({ track, score: Math.random() });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, count).map((s) => s.track.id);
  }

  async createMix(
    opts: RadioOptions & { name?: string; userId: string },
  ): Promise<typeof schema.playlists.$inferSelect> {
    const trackIds = await this.getOrderedTrackIds(opts);
    const id = newId();
    const name = opts.name ?? `Mix · ${new Date().toLocaleDateString()}`;

    await this.db.insert(schema.playlists).values({
      id,
      owner_user_id: opts.userId,
      name,
      description: 'Auto-generated mix',
      is_public: false,
    });

    if (trackIds.length) {
      await this.db.insert(schema.playlist_tracks).values(
        trackIds.map((trackId, i) => ({ playlist_id: id, track_id: trackId, position: i })),
      ).onConflictDoNothing();
    }

    this.logger.log(`Mix created: "${name}" (${trackIds.length} tracks) for user=${opts.userId}`);
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
