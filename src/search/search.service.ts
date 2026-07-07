import { Injectable, Inject } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as https from 'https';
import { SQLITE_TOKEN } from '../db/database.module';

export interface SearchHit {
  id: string;
  name: string;
  type: 'track' | 'artist' | 'album';
  artist?: string;
}

const MB_CACHE_TTL = 7 * 24 * 3600 * 1000;

@Injectable()
export class SearchService {
  constructor(@Inject(SQLITE_TOKEN) private readonly sqlite: Database.Database) {}

  async search(query: string, types: string[] = ['track', 'artist', 'album'], limit = 20): Promise<Record<string, SearchHit[]>> {
    const terms = await this.expandWithMusicBrainz(query);
    const results: Record<string, SearchHit[]> = {};

    if (types.includes('track')) {
      results.tracks = this.searchTracks(terms, limit);
    }
    if (types.includes('artist')) {
      results.artists = this.searchArtists(terms, limit);
    }
    if (types.includes('album')) {
      results.albums = this.searchAlbums(terms, limit);
    }

    return results;
  }

  searchTracksSimple(query: string, limit = 10): SearchHit[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    return this.searchTracks([trimmed], limit);
  }

  private async expandWithMusicBrainz(query: string): Promise<string[]> {
    const terms = new Set([query]);
    const cacheKey = `alias:${query.toLowerCase()}`;

    try {
      const cached = this.sqlite
        .prepare('SELECT data, fetched_at FROM mb_cache WHERE key = ?')
        .get(cacheKey) as { data: string; fetched_at: number } | undefined;

      if (cached && Date.now() - cached.fetched_at < MB_CACHE_TTL) {
        const aliases = JSON.parse(cached.data) as string[];
        aliases.forEach((a) => terms.add(a));
        return [...terms];
      }

      const ua = 'podo/1.0 (self-hosted music server)';
      const searchData = await this.mbGet(
        `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(query)}&limit=1&fmt=json`,
        ua,
      ) as { artists?: { id: string; name: string }[] };

      const artist = searchData.artists?.[0];
      if (!artist) {
        this.cacheAliases(cacheKey, []);
        return [...terms];
      }

      const detail = await this.mbGet(
        `https://musicbrainz.org/ws/2/artist/${artist.id}?inc=aliases&fmt=json`,
        ua,
      ) as { name: string; aliases?: { name: string }[] };

      const expanded = [detail.name, ...(detail.aliases ?? []).map((a) => a.name)]
        .filter((n) => n && n.toLowerCase() !== query.toLowerCase());

      this.cacheAliases(cacheKey, expanded);
      expanded.forEach((a) => terms.add(a));
    } catch {
      // MB unavailable or rate-limited — search with original term only
    }

    return [...terms];
  }

  private cacheAliases(key: string, aliases: string[]) {
    try {
      this.sqlite
        .prepare('INSERT OR REPLACE INTO mb_cache (key, data, fetched_at) VALUES (?, ?, ?)')
        .run(key, JSON.stringify(aliases), Date.now());
    } catch {}
  }

  private mbGet(url: string, userAgent: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const req = https.get(
        url,
        { headers: { 'User-Agent': userAgent, Accept: 'application/json' } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); }
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('MB timeout')); });
    });
  }

  private searchTracks(terms: string[], limit: number): SearchHit[] {
    const seen = new Map<string, { title: string; artist?: string }>();

    for (const term of terms) {
      try {
        const ftsQuery = this.toFtsQuery(term);
        const rows = this.sqlite.prepare(
          `SELECT t.id, COALESCE(ov.title, t.title) as title, COALESCE(ov.artist, t.artist) as artist
           FROM tracks_fts f
           JOIN tracks t ON t.rowid = f.rowid
           LEFT JOIN track_metadata_overrides ov ON ov.track_id = t.id
           WHERE tracks_fts MATCH ? AND t.deleted_at IS NULL
           ORDER BY rank
           LIMIT ?`,
        ).all(ftsQuery, limit) as { id: string; title: string; artist: string | null }[];
        for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, { title: r.title, artist: r.artist ?? undefined });
      } catch {}
    }

    if (terms.length > 0) {
      const conditions = terms.map(() =>
        `(lower(COALESCE(ov.artist,'')) LIKE lower(?) OR lower(COALESCE(ov.original_artist,'')) LIKE lower(?) OR lower(COALESCE(t.artist,'')) LIKE lower(?))`,
      ).join(' OR ');
      const params: unknown[] = terms.flatMap((t) => [`%${t}%`, `%${t}%`, `%${t}%`]);
      params.push(limit);
      try {
        const rows = this.sqlite.prepare(
          `SELECT DISTINCT t.id, COALESCE(ov.title, t.title) as title, COALESCE(ov.artist, t.artist) as artist
           FROM tracks t
           LEFT JOIN track_metadata_overrides ov ON ov.track_id = t.id
           WHERE t.deleted_at IS NULL AND (${conditions})
           LIMIT ?`,
        ).all(...params) as { id: string; title: string; artist: string | null }[];
        for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, { title: r.title, artist: r.artist ?? undefined });
      } catch {}
    }

    return [...seen.entries()].slice(0, limit).map(([id, { title, artist }]) => ({ id, name: title, artist, type: 'track' as const }));
  }

  private searchArtists(terms: string[], limit: number): SearchHit[] {
    const seen = new Map<string, string>();
    for (const term of terms) {
      try {
        const likeParam = `%${term}%`;
        const rows = this.sqlite.prepare(
          `SELECT DISTINCT COALESCE(ov.artist, t.artist) as name
           FROM tracks t
           LEFT JOIN track_metadata_overrides ov ON ov.track_id = t.id
           WHERE t.deleted_at IS NULL
             AND (lower(COALESCE(ov.artist,'')) LIKE lower(?)
               OR lower(COALESCE(ov.original_artist,'')) LIKE lower(?)
               OR lower(COALESCE(t.artist,'')) LIKE lower(?))
           LIMIT ?`,
        ).all(likeParam, likeParam, likeParam, limit) as { name: string | null }[];
        for (const r of rows) {
          if (!r.name) continue;
          for (const n of r.name.split(',').map((s) => s.trim()).filter(Boolean)) {
            if (!seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
          }
        }
      } catch {}
    }
    return [...seen.values()].slice(0, limit).map((name) => ({ id: name, name, type: 'artist' as const }));
  }

  private searchAlbums(terms: string[], limit: number): SearchHit[] {
    const seen = new Map<string, string>();
    for (const term of terms) {
      try {
        const ftsQuery = this.toFtsQuery(term);
        const rows = this.sqlite.prepare(
          `SELECT a.id, a.title FROM albums_fts f JOIN albums a ON a.rowid = f.rowid WHERE albums_fts MATCH ? ORDER BY rank LIMIT ?`,
        ).all(ftsQuery, limit) as { id: string; title: string }[];
        for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r.title);
      } catch {}
    }
    return [...seen.entries()].slice(0, limit).map(([id, name]) => ({ id, name, type: 'album' as const }));
  }

  private toFtsQuery(raw: string): string {
    const escaped = raw.replace(/["*]/g, '').trim();
    if (!escaped) return '""';
    return `"${escaped}"*`;
  }
}
