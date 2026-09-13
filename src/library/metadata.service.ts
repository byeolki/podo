import { Injectable, Logger, Inject } from '@nestjs/common';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { newId } from '../common/id';
import { ProbeResult } from './ffprobe.service';

interface ParsedMeta {
  title: string | null;
  artist: string | null;
  album: string | null;
  album_artist: string | null;
  track_number: number | null;
  disc_number: number | null;
  year: number | null;
  genres: string[];
}

@Injectable()
export class MetadataService {
  private readonly logger = new Logger(MetadataService.name);

  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  parseTags(probe: ProbeResult): ParsedMeta {
    const t = probe.tags;
    const raw = (k: string) => t[k] ?? t[k.toUpperCase()] ?? null;
    const num = (k: string) => {
      const v = raw(k);
      if (!v) return null;
      const n = parseInt(v.split('/')[0], 10);
      return isNaN(n) ? null : n;
    };

    return {
      title: raw('title'),
      artist: raw('artist'),
      album: raw('album'),
      album_artist: raw('album_artist') ?? raw('albumartist'),
      track_number: num('track'),
      disc_number: num('disc'),
      year: num('date') ?? num('year'),
      genres: (raw('genre') ?? '').split(/[;,]/).map((g) => g.trim()).filter(Boolean),
    };
  }

  async resolveOrCreateAlbumVersion(
    albumTitle: string,
    year: number | null,
  ): Promise<string> {
    const album = await this.db
      .select()
      .from(schema.albums)
      .where(eq(schema.albums.title, albumTitle))
      .get();

    let albumId: string;
    if (album) {
      albumId = album.id;
    } else {
      albumId = newId();
      await this.db.insert(schema.albums).values({ id: albumId, title: albumTitle });
    }

    const version = await this.db
      .select()
      .from(schema.album_versions)
      .where(
        and(
          eq(schema.album_versions.album_id, albumId),
          year ? eq(schema.album_versions.release_year, year) : isNull(schema.album_versions.release_year),
        ),
      )
      .get();

    if (version) return version.id;

    const versionId = newId();
    await this.db.insert(schema.album_versions).values({
      id: versionId,
      album_id: albumId,
      release_year: year ?? undefined,
    });
    return versionId;
  }

  async ensureGenres(genres: string[]): Promise<string[]> {
    if (!genres.length) return [];

    const rows = genres.map((name) => ({ id: newId(), name, kind: 'genre' as const }));
    await this.db.insert(schema.tags).values(rows).onConflictDoNothing();

    const existing = await this.db
      .select({ id: schema.tags.id, name: schema.tags.name })
      .from(schema.tags)
      .where(and(inArray(schema.tags.name, genres), eq(schema.tags.kind, 'genre')));

    return existing.map((r) => r.id);
  }

}
