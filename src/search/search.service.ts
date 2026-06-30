import { Injectable, Inject } from '@nestjs/common';
import Database from 'better-sqlite3';
import { SQLITE_TOKEN } from '../db/database.module';

export interface SearchHit {
  id: string;
  name: string;
  type: 'track' | 'artist' | 'album';
}

@Injectable()
export class SearchService {
  constructor(@Inject(SQLITE_TOKEN) private readonly sqlite: Database.Database) {}

  search(query: string, types: string[] = ['track', 'artist', 'album'], limit = 20): Record<string, SearchHit[]> {
    const terms = this.expandTerms(query);
    const results: Record<string, SearchHit[]> = {};

    if (types.includes('track')) {
      results.tracks = this.searchTracks(terms, query, limit);
    }
    if (types.includes('artist')) {
      results.artists = this.searchArtists(terms, limit);
    }
    if (types.includes('album')) {
      results.albums = this.searchAlbums(terms, limit);
    }

    return results;
  }

  private expandTerms(query: string): string[] {
    const terms = new Set([query]);
    try {
      const rows = this.sqlite.prepare(
        `SELECT name, alias FROM artist_aliases WHERE lower(name) = lower(?) OR lower(alias) = lower(?)`,
      ).all(query, query) as { name: string; alias: string }[];
      for (const row of rows) {
        terms.add(row.name);
        terms.add(row.alias);
      }
    } catch {
      // table may not exist during first boot
    }
    return [...terms];
  }

  private searchTracks(terms: string[], rawQuery: string, limit: number): SearchHit[] {
    const seen = new Map<string, string>();

    // FTS title search for each expanded term
    for (const term of terms) {
      try {
        const ftsQuery = this.toFtsQuery(term);
        const rows = this.sqlite.prepare(
          `SELECT t.id, COALESCE(ov.title, t.title) as title
           FROM tracks_fts f
           JOIN tracks t ON t.rowid = f.rowid
           LEFT JOIN track_metadata_overrides ov ON ov.track_id = t.id
           WHERE tracks_fts MATCH ? AND t.deleted_at IS NULL
           ORDER BY rank
           LIMIT ?`,
        ).all(ftsQuery, limit) as { id: string; title: string }[];
        for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r.title);
      } catch {}
    }

    // LIKE search on artist name fields (override + track_artists table)
    if (terms.length > 0) {
      const conditions = terms.map(() =>
        `(lower(COALESCE(ov.artist,'')) LIKE lower(?) OR lower(COALESCE(ov.original_artist,'')) LIKE lower(?) OR lower(COALESCE(a.name,'')) LIKE lower(?) OR lower(COALESCE(ov.alternate_titles,'')) LIKE lower(?))`,
      ).join(' OR ');
      const params: unknown[] = terms.flatMap((t) => [`%${t}%`, `%${t}%`, `%${t}%`, `%${t}%`]);
      params.push(limit);
      try {
        const rows = this.sqlite.prepare(
          `SELECT DISTINCT t.id, COALESCE(ov.title, t.title) as title
           FROM tracks t
           LEFT JOIN track_metadata_overrides ov ON ov.track_id = t.id
           LEFT JOIN track_artists ta ON ta.track_id = t.id
           LEFT JOIN artists a ON a.id = ta.artist_id
           WHERE t.deleted_at IS NULL AND (${conditions})
           LIMIT ?`,
        ).all(...params) as { id: string; title: string }[];
        for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r.title);
      } catch {}
    }

    return [...seen.entries()].slice(0, limit).map(([id, name]) => ({ id, name, type: 'track' as const }));
  }

  private searchArtists(terms: string[], limit: number): SearchHit[] {
    const seen = new Map<string, string>();
    for (const term of terms) {
      try {
        const ftsQuery = this.toFtsQuery(term);
        const rows = this.sqlite.prepare(
          `SELECT a.id, a.name FROM artists_fts f JOIN artists a ON a.rowid = f.rowid WHERE artists_fts MATCH ? ORDER BY rank LIMIT ?`,
        ).all(ftsQuery, limit) as { id: string; name: string }[];
        for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r.name);
      } catch {}
    }
    return [...seen.entries()].slice(0, limit).map(([id, name]) => ({ id, name, type: 'artist' as const }));
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
