import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { eq, asc, and, isNull, inArray } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { TracksService } from '../tracks/tracks.service';

@Injectable()
export class AlbumsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly tracks: TracksService,
  ) {}

  /**
   * Album rows carry no year or artwork of their own — both live on
   * `album_versions`. The list view needs them anyway (to sort by year and to
   * render a cover), so each album is flattened against a representative
   * version: the first one that actually has an artwork file, else the oldest.
   */
  async findAll() {
    const albums = await this.db.select().from(schema.albums).orderBy(asc(schema.albums.title));
    if (!albums.length) return [];

    const versions = await this.db
      .select()
      .from(schema.album_versions)
      .where(inArray(schema.album_versions.album_id, albums.map((a) => a.id)))
      .orderBy(asc(schema.album_versions.created_at));

    const representative = new Map<string, typeof schema.album_versions.$inferSelect>();
    for (const version of versions) {
      const current = representative.get(version.album_id);
      if (!current || (!current.artwork_path && version.artwork_path)) {
        representative.set(version.album_id, version);
      }
    }

    return albums.map((album) => {
      const version = representative.get(album.id);
      return {
        ...album,
        year: version?.release_year ?? null,
        // `GET /artwork/:id` takes an album *version* id, not an album id.
        artwork_id: version?.artwork_path ? version.id : null,
      };
    });
  }

  async findOne(id: string) {
    const album = await this.db.select().from(schema.albums).where(eq(schema.albums.id, id)).get();
    if (!album) throw new NotFoundException('Album not found');

    const versions = await this.db
      .select()
      .from(schema.album_versions)
      .where(eq(schema.album_versions.album_id, id));

    const versionIds = versions.map((v) => v.id);
    if (!versionIds.length) {
      return { ...album, versions: versions.map((v) => ({ ...v, tracks: [] })) };
    }

    const trackIds = await this.db
      .select({ id: schema.tracks.id })
      .from(schema.tracks)
      .where(and(inArray(schema.tracks.album_version_id, versionIds), isNull(schema.tracks.deleted_at)));

    // Enriched through TracksService so an edited title/artist shows here too —
    // a plain `tracks` select skips the metadata-override layer entirely.
    const enriched = await this.tracks.findByIds(trackIds.map((t) => t.id));

    const tracksByVersion = new Map<string, typeof enriched>();
    for (const track of enriched) {
      const key = track.album_version_id ?? '';
      const bucket = tracksByVersion.get(key);
      if (bucket) bucket.push(track);
      else tracksByVersion.set(key, [track]);
    }

    return {
      ...album,
      versions: versions.map((v) => ({
        ...v,
        tracks: (tracksByVersion.get(v.id) ?? []).sort(
          (a, b) => (a.disc_number ?? 0) - (b.disc_number ?? 0) || (a.track_number ?? 0) - (b.track_number ?? 0),
        ),
      })),
    };
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
