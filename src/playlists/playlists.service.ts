import { Injectable, NotFoundException, ForbiddenException, Inject } from '@nestjs/common';
import { eq, and, asc, isNull, sql } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { newId } from '../common/id';

@Injectable()
export class PlaylistsService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  findAll(userId: string) {
    return this.db
      .select()
      .from(schema.playlists)
      .where(and(eq(schema.playlists.owner_user_id, userId), isNull(schema.playlists.deleted_at)));
  }

  findPublic() {
    return this.db
      .select()
      .from(schema.playlists)
      .where(and(eq(schema.playlists.is_public, true), isNull(schema.playlists.deleted_at)));
  }

  async findOne(id: string, userId: string) {
    const playlist = await this.db
      .select()
      .from(schema.playlists)
      .where(and(eq(schema.playlists.id, id), isNull(schema.playlists.deleted_at)))
      .get();
    if (!playlist) throw new NotFoundException('Playlist not found');
    if (playlist.owner_user_id !== userId && !playlist.is_public) throw new ForbiddenException();

    const tracks = await this.db
      .select({ track: schema.tracks, position: schema.playlist_tracks.position })
      .from(schema.playlist_tracks)
      .innerJoin(schema.tracks, eq(schema.playlist_tracks.track_id, schema.tracks.id))
      .where(eq(schema.playlist_tracks.playlist_id, id))
      .orderBy(asc(schema.playlist_tracks.position));

    return { ...playlist, tracks: tracks.map((t) => ({ ...t.track, position: t.position })) };
  }

  async create(dto: { name: string; description?: string; is_public?: boolean }, userId: string) {
    const id = newId();
    await this.db.insert(schema.playlists).values({
      id,
      owner_user_id: userId,
      name: dto.name,
      description: dto.description,
      is_public: dto.is_public ?? false,
    });
    return this.db.select().from(schema.playlists).where(eq(schema.playlists.id, id)).get();
  }

  async update(id: string, dto: { name?: string; description?: string; is_public?: boolean; track_ids?: string[] }, userId: string) {
    await this.requireOwner(id, userId);

    if (dto.name || dto.description !== undefined || dto.is_public !== undefined) {
      await this.db.update(schema.playlists).set({
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.is_public !== undefined && { is_public: dto.is_public }),
        updated_at: new Date(),
      }).where(eq(schema.playlists.id, id));
    }

    if (dto.track_ids) {
      await this.db.delete(schema.playlist_tracks).where(eq(schema.playlist_tracks.playlist_id, id));
      if (dto.track_ids.length) {
        await this.db.insert(schema.playlist_tracks).values(
          dto.track_ids.map((track_id, i) => ({ playlist_id: id, track_id, position: i })),
        ).onConflictDoNothing();
      }
    }

    return this.findOne(id, userId);
  }

  async addTracks(id: string, trackIds: string[], userId: string) {
    await this.requireOwner(id, userId);
    if (!trackIds.length) return;

    const maxPos = await this.db.all<{ pos: number | null }>(
      sql`SELECT MAX(position) as pos FROM playlist_tracks WHERE playlist_id = ${id}`,
    );
    const base = (maxPos[0]?.pos ?? -1) + 1;

    await this.db.insert(schema.playlist_tracks).values(
      trackIds.map((track_id, i) => ({ playlist_id: id, track_id, position: base + i })),
    ).onConflictDoNothing();

    await this.db.update(schema.playlists).set({ updated_at: new Date() }).where(eq(schema.playlists.id, id));
  }

  async remove(id: string, userId: string) {
    await this.requireOwner(id, userId);
    await this.db.update(schema.playlists).set({ deleted_at: new Date() }).where(eq(schema.playlists.id, id));
  }

  private async requireOwner(id: string, userId: string) {
    const playlist = await this.db.select().from(schema.playlists).where(eq(schema.playlists.id, id)).get();
    if (!playlist) throw new NotFoundException('Playlist not found');
    if (playlist.owner_user_id !== userId) throw new ForbiddenException();
    return playlist;
  }
}
