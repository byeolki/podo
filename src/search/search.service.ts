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
    const term = this.toFtsQuery(query);
    const results: Record<string, SearchHit[]> = {};

    if (types.includes('track')) {
      const rows = this.sqlite.prepare<[string, number], { id: string; title: string }>(
        `SELECT t.id, t.title
         FROM tracks_fts f
         JOIN tracks t ON t.rowid = f.rowid
         WHERE tracks_fts MATCH ?
         AND t.deleted_at IS NULL
         ORDER BY rank
         LIMIT ?`
      ).all(term, limit) as { id: string; title: string }[];
      results.tracks = rows.map((r) => ({ id: r.id, name: r.title, type: 'track' }));
    }

    if (types.includes('artist')) {
      const rows = this.sqlite.prepare<[string, number], { id: string; name: string }>(
        `SELECT a.id, a.name
         FROM artists_fts f
         JOIN artists a ON a.rowid = f.rowid
         WHERE artists_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      ).all(term, limit) as { id: string; name: string }[];
      results.artists = rows.map((r) => ({ id: r.id, name: r.name, type: 'artist' }));
    }

    if (types.includes('album')) {
      const rows = this.sqlite.prepare<[string, number], { id: string; title: string }>(
        `SELECT a.id, a.title
         FROM albums_fts f
         JOIN albums a ON a.rowid = f.rowid
         WHERE albums_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      ).all(term, limit) as { id: string; title: string }[];
      results.albums = rows.map((r) => ({ id: r.id, name: r.title, type: 'album' }));
    }

    return results;
  }

  private toFtsQuery(raw: string): string {
    const escaped = raw.replace(/["*]/g, '').trim();
    if (!escaped) return '""';
    return `"${escaped}"*`;
  }
}
