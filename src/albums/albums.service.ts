import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { eq, asc } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';

@Injectable()
export class AlbumsService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  findAll() {
    return this.db.select().from(schema.albums).orderBy(asc(schema.albums.title));
  }

  async findOne(id: string) {
    const album = await this.db.select().from(schema.albums).where(eq(schema.albums.id, id)).get();
    if (!album) throw new NotFoundException('Album not found');

    const versions = await this.db
      .select()
      .from(schema.album_versions)
      .where(eq(schema.album_versions.album_id, id));

    const artist = album.primary_artist_id
      ? await this.db.select().from(schema.artists).where(eq(schema.artists.id, album.primary_artist_id)).get()
      : null;

    return { ...album, artist, versions };
  }

  async updateArtwork(albumVersionId: string, artworkPath: string) {
    const version = await this.db
      .select()
      .from(schema.album_versions)
      .where(eq(schema.album_versions.id, albumVersionId))
      .get();
    if (!version) throw new NotFoundException('Album version not found');

    await this.db
      .update(schema.album_versions)
      .set({ artwork_path: artworkPath, updated_at: new Date() })
      .where(eq(schema.album_versions.id, albumVersionId));

    return { artwork_path: artworkPath };
  }
}
