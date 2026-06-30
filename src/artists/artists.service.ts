import { Injectable, Inject } from '@nestjs/common';
import { eq, isNull, sql } from 'drizzle-orm';
import * as https from 'https';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { TracksService } from '../tracks/tracks.service';

const LASTFM_CACHE_TTL = 30 * 24 * 3600 * 1000;

export interface LastFmArtistInfo {
  image?: string;
  tags?: string[];
}

@Injectable()
export class ArtistsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly tracks: TracksService,
  ) {}

  async findAll(): Promise<{ name: string; track_count: number; is_performer: boolean; image: string | null }[]> {
    const rows = await this.db.all<{
      ov_artist: string | null;
      ov_original_artist: string | null;
      t_artist: string | null;
      is_cover: number;
    }>(sql`
      SELECT ov.artist as ov_artist, ov.original_artist as ov_original_artist,
             t.artist as t_artist, COALESCE(ov.is_cover, t.is_cover, 0) as is_cover
      FROM tracks t
      LEFT JOIN track_metadata_overrides ov ON ov.track_id = t.id
      WHERE t.deleted_at IS NULL
    `);

    const artistMap = new Map<string, { name: string; track_count: number; is_performer: boolean }>();

    const add = (raw: string, isPerformer: boolean) => {
      for (const n of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
        const key = n.toLowerCase();
        const existing = artistMap.get(key);
        if (existing) {
          existing.track_count++;
          if (isPerformer) existing.is_performer = true;
        } else {
          artistMap.set(key, { name: n, track_count: 1, is_performer: isPerformer });
        }
      }
    };

    for (const r of rows) {
      if (r.ov_artist) add(r.ov_artist, true);
      if (r.ov_original_artist) add(r.ov_original_artist, false);
      if (!r.ov_artist && !r.ov_original_artist && r.t_artist) add(r.t_artist, false);
    }

    const artists = [...artistMap.values()].sort((a, b) => a.name.localeCompare(b.name));

    const cacheRows = await this.db.all<{ key: string; image: string | null }>(sql`
      SELECT key, json_extract(data, '$.image') as image FROM mb_cache
      WHERE key LIKE 'lastfm:artist:%'
    `);
    const imageByKey = new Map(cacheRows.map((r) => [r.key, r.image]));

    return artists.map((a) => ({
      ...a,
      image: imageByKey.get(`lastfm:artist:${a.name.toLowerCase()}`) ?? null,
    }));
  }

  async findByName(name: string) {
    const lower = name.toLowerCase();
    const rows = await this.db.all<{ track_id: string }>(sql`
      SELECT DISTINCT t.id as track_id
      FROM tracks t
      LEFT JOIN track_metadata_overrides ov ON ov.track_id = t.id
      WHERE t.deleted_at IS NULL AND (
        lower(ov.artist) = ${lower} OR
        lower(ov.original_artist) = ${lower} OR
        lower(t.artist) = ${lower} OR
        (',' || lower(COALESCE(ov.artist,'')) || ',') LIKE ('%,' || ${lower} || ',%') OR
        (',' || lower(COALESCE(ov.original_artist,'')) || ',') LIKE ('%,' || ${lower} || ',%')
      )
    `);

    const [fullTracks, lastfm] = await Promise.all([
      this.tracks.findByIds(rows.map((r) => r.track_id)),
      this.getLastFmInfo(name),
    ]);

    return { name, tracks: fullTracks, lastfm };
  }

  private async getLastFmInfo(name: string): Promise<LastFmArtistInfo | null> {
    const apiKey = process.env.LASTFM_API_KEY;
    if (!apiKey) return null;

    const cacheKey = `lastfm:artist:${name.toLowerCase()}`;
    const cached = this.db.select().from(schema.mb_cache).where(eq(schema.mb_cache.key, cacheKey)).get();

    if (cached && Date.now() - cached.fetched_at.getTime() < LASTFM_CACHE_TTL) {
      return cached.data as LastFmArtistInfo | null;
    }

    try {
      const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(name)}&api_key=${apiKey}&format=json&autocorrect=1`;
      const data = await this.httpGet(url) as { artist?: { tags?: { tag?: { name: string }[] } }; error?: number };

      if (data.error || !data.artist) {
        this.cacheLastFm(cacheKey, null);
        return null;
      }

      const tags = (data.artist.tags?.tag ?? []).slice(0, 5).map((t) => t.name).filter(Boolean);
      const image = await this.getWikipediaImage(name);

      const info: LastFmArtistInfo = { image: image || undefined, tags: tags.length ? tags : undefined };
      this.cacheLastFm(cacheKey, info);
      return info;
    } catch {
      return null;
    }
  }

  private async getWikipediaImage(name: string): Promise<string | null> {
    try {
      const direct = await this.httpGet(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`,
      ) as { thumbnail?: { source: string }; type?: string };

      if (direct.type !== 'disambiguation' && direct.thumbnail?.source) {
        return direct.thumbnail.source;
      }

      const search = await this.httpGet(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&srlimit=1`,
      ) as { query?: { search?: { title: string }[] } };

      const title = search.query?.search?.[0]?.title;
      if (!title) return null;

      const page = await this.httpGet(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      ) as { thumbnail?: { source: string }; type?: string };

      if (page.type === 'disambiguation') return null;
      return page.thumbnail?.source ?? null;
    } catch {
      return null;
    }
  }

  private cacheLastFm(key: string, data: LastFmArtistInfo | null) {
    try {
      this.db.insert(schema.mb_cache).values({ key, data: data as Record<string, unknown>, fetched_at: new Date() })
        .onConflictDoUpdate({ target: schema.mb_cache.key, set: { data: data as Record<string, unknown>, fetched_at: new Date() } })
        .run();
    } catch {}
  }

  private httpGet(url: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': 'podo/1.0' } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    });
  }
}
