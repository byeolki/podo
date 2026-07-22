import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { TracksService } from '../tracks/tracks.service';

@Injectable()
export class FavoritesService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly tracks: TracksService,
  ) {}

  async findAll(userId: string) {
    const favs = await this.db
      .select({ track_id: schema.favorites.track_id, created_at: schema.favorites.created_at })
      .from(schema.favorites)
      .where(eq(schema.favorites.user_id, userId))
      .orderBy(desc(schema.favorites.created_at));
    if (!favs.length) return [];

    // findByIds resolves title/artist/is_cover overrides the same way the library
    // list does — a plain `tracks` select (the old query here) skips that entirely,
    // so edited titles/artists silently reverted to the raw scanned filename outside
    // the library list.
    const enriched = await this.tracks.findByIds(favs.map((f) => f.track_id), userId);
    const byId = new Map(enriched.map((t) => [t.id, t]));
    // Response stays wrapped as `{ track }[]` (not a flat array) — the muscat client's
    // `FavoriteEntry` model decodes exactly this shape.
    return favs
      .map((f) => {
        const track = byId.get(f.track_id);
        return track ? { track } : null;
      })
      .filter((t): t is NonNullable<typeof t> => !!t);
  }

  async add(userId: string, trackId: string) {
    const track = await this.db.select({ id: schema.tracks.id }).from(schema.tracks).where(eq(schema.tracks.id, trackId)).get();
    if (!track) throw new NotFoundException('Track not found');

    await this.db
      .insert(schema.favorites)
      .values({ user_id: userId, track_id: trackId })
      .onConflictDoNothing();
    return { favorited: true };
  }

  async remove(userId: string, trackId: string) {
    await this.db.delete(schema.favorites).where(
      and(eq(schema.favorites.user_id, userId), eq(schema.favorites.track_id, trackId)),
    );
    return { favorited: false };
  }
}
