import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { eq, asc } from 'drizzle-orm';
import * as https from 'https';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { newId } from '../common/id';
import { TracksService } from '../tracks/tracks.service';

const LASTFM_CACHE_TTL = 30 * 24 * 3600 * 1000;

export interface LastFmArtistInfo {
  bio?: string;
  image?: string;
  tags?: string[];
}

@Injectable()
export class ArtistsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly tracks: TracksService,
  ) {}

  findAll() {
    return this.db.select().from(schema.artists).orderBy(asc(schema.artists.name));
  }

  async findOne(id: string) {
    const artist = await this.db.select().from(schema.artists).where(eq(schema.artists.id, id)).get();
    if (!artist) throw new NotFoundException('Artist not found');

    const [rows, lastfm] = await Promise.all([
      this.db.select({ track_id: schema.track_artists.track_id }).from(schema.track_artists).where(eq(schema.track_artists.artist_id, id)),
      this.getLastFmInfo(artist.name),
    ]);

    const fullTracks = await this.tracks.findByIds(rows.map((r) => r.track_id));

    return {
      ...artist,
      tracks: fullTracks,
      lastfm,
    };
  }

  private async getLastFmInfo(name: string): Promise<LastFmArtistInfo | null> {
    const apiKey = process.env.LASTFM_API_KEY;
    if (!apiKey) return null;

    const cacheKey = `lastfm:artist:${name.toLowerCase()}`;
    const cached = this.db
      .select()
      .from(schema.mb_cache)
      .where(eq(schema.mb_cache.key, cacheKey))
      .get();

    if (cached && Date.now() - cached.fetched_at.getTime() < LASTFM_CACHE_TTL) {
      return cached.data as LastFmArtistInfo | null;
    }

    try {
      const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(name)}&api_key=${apiKey}&format=json&autocorrect=1`;
      const data = await this.httpGet(url) as {
        artist?: {
          bio?: { summary?: string };
          image?: { '#text': string; size: string }[];
          tags?: { tag?: { name: string }[] };
        };
        error?: number;
      };

      if (data.error || !data.artist) {
        this.cacheLastFm(cacheKey, null);
        return null;
      }

      const a = data.artist;
      const rawBio = a.bio?.summary ?? '';
      const bio = rawBio.replace(/<a\b[^>]*>.*?<\/a>/gi, '').replace(/<[^>]+>/g, '').trim() || undefined;
      const image = a.image?.find((img) => img.size === 'extralarge' || img.size === 'large')?.['#text'] || undefined;
      const tags = (a.tags?.tag ?? []).slice(0, 5).map((t) => t.name).filter(Boolean);

      const info: LastFmArtistInfo = { bio, image: image || undefined, tags: tags.length ? tags : undefined };
      this.cacheLastFm(cacheKey, info);
      return info;
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

  async create(dto: { name: string; is_custom?: boolean }, userId: string) {
    const id = newId();
    await this.db.insert(schema.artists).values({
      id, name: dto.name.trim(), is_custom: dto.is_custom ?? true, external_ids: {}, created_by: userId,
    });
    return this.findOne(id);
  }

  async update(id: string, dto: { name?: string; external_ids?: Record<string, string> }) {
    const artist = await this.db.select().from(schema.artists).where(eq(schema.artists.id, id)).get();
    if (!artist) throw new NotFoundException('Artist not found');

    await this.db.update(schema.artists).set({
      ...(dto.name && { name: dto.name.trim() }),
      ...(dto.external_ids && { external_ids: dto.external_ids }),
      updated_at: new Date(),
    }).where(eq(schema.artists.id, id));

    return this.findOne(id);
  }
}
