import { Injectable, Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';

@Injectable()
export class FavoritesService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  findAll(userId: string) {
    return this.db
      .select({ track: schema.tracks })
      .from(schema.favorites)
      .innerJoin(schema.tracks, eq(schema.favorites.track_id, schema.tracks.id))
      .where(eq(schema.favorites.user_id, userId));
  }

  async add(userId: string, trackId: string) {
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
