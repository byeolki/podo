import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { newId } from '../common/id';
import { ProbeResult } from './ffprobe.service';
import PQueue from 'p-queue';
import * as https from 'https';

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
  private readonly mbQueue = new PQueue({ interval: 1000, intervalCap: 1 });
  private readonly userAgent: string;

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly config: ConfigService,
  ) {
    this.userAgent = config.get('musicbrainz_user_agent', 'podo/0.1.0');
  }

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

  async resolveOrCreateArtist(name: string): Promise<string> {
    const normalized = name.trim();
    const existing = await this.db
      .select()
      .from(schema.artists)
      .where(eq(schema.artists.name, normalized))
      .get();

    if (existing) return existing.id;

    const id = newId();
    await this.db.insert(schema.artists).values({ id, name: normalized });
    return id;
  }

  async resolveOrCreateAlbumVersion(
    albumTitle: string,
    artistId: string | null,
    year: number | null,
  ): Promise<string> {
    const album = await this.db
      .select()
      .from(schema.albums)
      .where(
        and(
          eq(schema.albums.title, albumTitle),
          artistId ? eq(schema.albums.primary_artist_id, artistId) : eq(schema.albums.primary_artist_id, ''),
        ),
      )
      .get();

    let albumId: string;
    if (album) {
      albumId = album.id;
    } else {
      albumId = newId();
      await this.db.insert(schema.albums).values({
        id: albumId,
        title: albumTitle,
        primary_artist_id: artistId ?? undefined,
      });
    }

    const version = await this.db
      .select()
      .from(schema.album_versions)
      .where(
        and(
          eq(schema.album_versions.album_id, albumId),
          year ? eq(schema.album_versions.release_year, year) : eq(schema.album_versions.release_year, 0),
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
    const ids: string[] = [];
    for (const name of genres) {
      const existing = await this.db
        .select()
        .from(schema.tags)
        .where(and(eq(schema.tags.name, name), eq(schema.tags.kind, 'genre')))
        .get();
      if (existing) {
        ids.push(existing.id);
      } else {
        const id = newId();
        await this.db.insert(schema.tags).values({ id, name, kind: 'genre' }).onConflictDoNothing();
        ids.push(id);
      }
    }
    return ids;
  }

  async fetchMusicBrainz(artist: string, title: string): Promise<Record<string, unknown> | null> {
    const cacheKey = `mb:${artist}:${title}`;
    const cached = await this.db
      .select()
      .from(schema.mb_cache)
      .where(eq(schema.mb_cache.key, cacheKey))
      .get();

    if (cached) return cached.data as Record<string, unknown>;

    const result = await this.mbQueue.add(async () => {
      const query = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
      const url = `https://musicbrainz.org/ws/2/recording/?query=${query}&limit=1&fmt=json`;

      try {
        const data = await this.httpGet(url, { 'User-Agent': this.userAgent });
        await this.db
          .insert(schema.mb_cache)
          .values({ key: cacheKey, data: data as Record<string, unknown> })
          .onConflictDoUpdate({ target: schema.mb_cache.key, set: { data: data as Record<string, unknown>, fetched_at: new Date() } });
        return data as Record<string, unknown>;
      } catch (e) {
        this.logger.warn(`MusicBrainz fetch failed: ${e}`);
        return null;
      }
    });
    return result ?? null;
  }

  private httpGet(url: string, headers: Record<string, string>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers }, (res) => {
        let body = '';
        res.on('data', (d: Buffer) => { body += d.toString(); });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    });
  }
}
