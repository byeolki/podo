import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { eq, asc, and, isNull, inArray } from 'drizzle-orm';
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

    const versionIds = versions.map((v) => v.id);
    let versionsWithTracks = versions.map((v) => ({ ...v, tracks: [] as Record<string, unknown>[] }));

    if (versionIds.length > 0) {
      const rawTracks = await this.db
        .select()
        .from(schema.tracks)
        .where(and(inArray(schema.tracks.album_version_id, versionIds), isNull(schema.tracks.deleted_at)));

      if (rawTracks.length > 0) {
        const enrichedTracks = rawTracks.map((t) => ({
          ...t,
          duration: t.canonical_duration,
          artists: (t.artist ?? '').split(',').map((n) => ({ name: n.trim() })).filter((a) => a.name),
        }));

        const tracksByVersion = new Map<string, typeof enrichedTracks>();
        for (const track of enrichedTracks) {
          const key = track.album_version_id ?? '';
          if (!tracksByVersion.has(key)) tracksByVersion.set(key, []);
          tracksByVersion.get(key)!.push(track);
        }

        versionsWithTracks = versions.map((v) => ({
          ...v,
          tracks: (tracksByVersion.get(v.id) ?? []).sort(
            (a, b) => (a.disc_number ?? 0) - (b.disc_number ?? 0) || (a.track_number ?? 0) - (b.track_number ?? 0),
          ),
        }));
      }
    }

    return { ...album, versions: versionsWithTracks };
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
