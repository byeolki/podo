import { Injectable, Inject } from '@nestjs/common';
import { eq, and, inArray, notInArray, isNull, sql } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { newId } from '../common/id';

export interface RadioOptions {
  seedTrackId?: string;
  seedArtistId?: string;
  count?: number;
  excludeIds?: string[];
}

@Injectable()
export class RadioService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async getStation(opts: RadioOptions): Promise<typeof schema.tracks.$inferSelect[]> {
    const count = Math.min(opts.count ?? 50, 200);
    const excludeIds = opts.excludeIds ?? [];

    const seedArtistIds = await this.resolveSeedArtists(opts);
    const seedTagIds = await this.resolveSeedTags(opts);

    const scored: Array<{ track: typeof schema.tracks.$inferSelect; score: number }> = [];
    const seen = new Set<string>(excludeIds);

    const baseCond = and(
      isNull(schema.tracks.deleted_at),
      excludeIds.length ? notInArray(schema.tracks.id, excludeIds) : undefined,
    );

    if (seedArtistIds.length) {
      const rows = await this.db
        .select({ track: schema.tracks })
        .from(schema.tracks)
        .innerJoin(schema.track_artists, eq(schema.track_artists.track_id, schema.tracks.id))
        .where(and(baseCond, inArray(schema.track_artists.artist_id, seedArtistIds)));

      for (const { track } of rows) {
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

    for (let i = 0; i < tracks.length; i++) {
      await this.db.insert(schema.playlist_tracks).values({
        playlist_id: id,
        track_id: tracks[i].id,
        position: i,
      }).onConflictDoNothing();
    }

    return (await this.db.select().from(schema.playlists).where(eq(schema.playlists.id, id)).get())!;
  }

  private async resolveSeedArtists(opts: RadioOptions): Promise<string[]> {
    const ids = new Set<string>();

    if (opts.seedArtistId) ids.add(opts.seedArtistId);

    if (opts.seedTrackId) {
      const rows = await this.db
        .select({ artist_id: schema.track_artists.artist_id })
        .from(schema.track_artists)
        .where(eq(schema.track_artists.track_id, opts.seedTrackId));
      for (const r of rows) ids.add(r.artist_id);
    }

    return [...ids];
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
