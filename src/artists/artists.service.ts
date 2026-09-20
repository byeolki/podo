import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { and, isNull } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { TracksService } from '../tracks/tracks.service';

/** One name, with what the library holds under it. */
export interface ArtistSummary {
  /** Opaque, URL-safe handle for the name — see `encodeArtistId`. */
  id: string;
  name: string;
  /** Tracks this name is credited on, alone or alongside others. */
  track_count: number;
  /** How many of those are covers. */
  cover_count: number;
  /** Tracks by someone else that this name originally released. */
  original_count: number;
  /** Album version id for the cover art, or null. */
  artwork_id: string | null;
  /** Track id carrying a standalone thumbnail, used when there is no album art. */
  thumbnail_track_id: string | null;
}

/**
 * A name as it is written, reduced to something two spellings of the same artist
 * can share. Width and case are the differences that actually occur — "IU" and
 * "ＩＵ" are one artist, and a credit typed twice rarely agrees on case.
 */
export function artistKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Names travel in URLs, and a credit is free text: it can hold a slash, a
 * question mark, or a percent sign, none of which survive a path segment intact
 * once a proxy has normalised it. base64url of the key is a segment that always
 * does, and it round-trips without a table to look it up in — there is no
 * artists table for an id to point at.
 */
export function encodeArtistId(name: string): string {
  return Buffer.from(artistKey(name), 'utf8').toString('base64url');
}

export function decodeArtistId(id: string): string | null {
  try {
    const decoded = Buffer.from(id, 'base64url').toString('utf8');
    return decoded.trim() ? decoded : null;
  } catch {
    return null;
  }
}

/** The credit string as stored, split into the people it names. */
function splitCredit(credit: string | null): string[] {
  if (!credit) return [];
  return credit.split(',').map((n) => n.trim()).filter(Boolean);
}

interface Accumulated {
  display: Map<string, number>;
  trackIds: string[];
  coverCount: number;
  originalCount: number;
  artworkId: string | null;
  thumbnailTrackId: string | null;
}

/**
 * Artists, derived rather than stored.
 *
 * There is no artists table: a track carries one free-text credit, which for
 * this library is usually several people separated by commas ("송밤, 키마, 콧시,
 * 윤단"). Listing the credit strings themselves would be useless — it shows
 * seventeen entries for about twenty people, and not one of them is a name you
 * can click. So every credit is split, and the same split the track list already
 * does (`resolveArtists`) is what decides who is on a track.
 *
 * `original_artist` is counted too, because the library is mostly covers: the
 * person who first released a song is an artist worth having a page, even when
 * nothing here is performed by them.
 */
@Injectable()
export class ArtistsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly tracks: TracksService,
  ) {}

  private async credits() {
    const [rows, overrides] = await Promise.all([
      this.db
        .select({
          id: schema.tracks.id,
          artist: schema.tracks.artist,
          is_cover: schema.tracks.is_cover,
          album_version_id: schema.tracks.album_version_id,
          thumbnail_path: schema.tracks.thumbnail_path,
          added_at: schema.tracks.added_at,
        })
        .from(schema.tracks)
        .where(isNull(schema.tracks.deleted_at)),
      this.db
        .select({
          track_id: schema.track_metadata_overrides.track_id,
          artist: schema.track_metadata_overrides.artist,
          original_artist: schema.track_metadata_overrides.original_artist,
          is_cover: schema.track_metadata_overrides.is_cover,
        })
        .from(schema.track_metadata_overrides),
    ]);

    const overrideByTrack = new Map(overrides.map((o) => [o.track_id, o]));
    return rows.map((t) => {
      const ov = overrideByTrack.get(t.id);
      return {
        ...t,
        // The override wins wherever it exists — the same precedence the track
        // list uses, or an artist page disagrees with the rows it is made of.
        performers: splitCredit(ov?.artist ?? t.artist),
        original: (ov?.original_artist ?? '').trim(),
        is_cover: ov?.is_cover ?? t.is_cover,
      };
    });
  }

  async findAll(): Promise<ArtistSummary[]> {
    const tracks = await this.credits();
    const byKey = new Map<string, Accumulated>();

    const bucket = (name: string): Accumulated => {
      const key = artistKey(name);
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          display: new Map(),
          trackIds: [],
          coverCount: 0,
          originalCount: 0,
          artworkId: null,
          thumbnailTrackId: null,
        };
        byKey.set(key, entry);
      }
      entry.display.set(name, (entry.display.get(name) ?? 0) + 1);
      return entry;
    };

    for (const track of tracks) {
      for (const name of track.performers) {
        const entry = bucket(name);
        entry.trackIds.push(track.id);
        if (track.is_cover) entry.coverCount++;
        if (!entry.artworkId && track.album_version_id) entry.artworkId = track.album_version_id;
        if (!entry.thumbnailTrackId && track.thumbnail_path) entry.thumbnailTrackId = track.id;
      }
      if (track.original) bucket(track.original).originalCount++;
    }

    return [...byKey.entries()]
      .map(([key, entry]) => ({
        id: Buffer.from(key, 'utf8').toString('base64url'),
        name: mostCommon(entry.display),
        track_count: entry.trackIds.length,
        cover_count: entry.coverCount,
        original_count: entry.originalCount,
        artwork_id: entry.artworkId,
        thumbnail_track_id: entry.thumbnailTrackId,
      }))
      .sort((a, b) => b.track_count - a.track_count || a.name.localeCompare(b.name));
  }

  /**
   * One artist: what they are on, and separately what is theirs but performed by
   * someone else. Both lists go through `TracksService` so an edited title or
   * credit reads the same here as in the library.
   */
  async findOne(id: string, userId?: string) {
    const key = decodeArtistId(id);
    if (!key) throw new NotFoundException('Artist not found');

    const tracks = await this.credits();
    const display = new Map<string, number>();
    const performedIds: string[] = [];
    const originalIds: string[] = [];

    for (const track of tracks) {
      const credited = track.performers.find((n) => artistKey(n) === key);
      if (credited) {
        display.set(credited, (display.get(credited) ?? 0) + 1);
        performedIds.push(track.id);
      }
      if (track.original && artistKey(track.original) === key) {
        display.set(track.original, (display.get(track.original) ?? 0) + 1);
        // A track someone is credited on *and* originally released is theirs
        // twice over; it belongs in the list of what they perform, not in the
        // list of their songs that other people covered.
        if (!credited) originalIds.push(track.id);
      }
    }

    if (!performedIds.length && !originalIds.length) throw new NotFoundException('Artist not found');

    const [performed, originals] = await Promise.all([
      this.tracks.findByIds(performedIds, userId),
      this.tracks.findByIds(originalIds, userId),
    ]);

    const byAdded = (a: { added_at: Date }, b: { added_at: Date }) =>
      b.added_at.getTime() - a.added_at.getTime();

    return {
      id,
      name: mostCommon(display),
      tracks: [...performed].sort(byAdded),
      original_tracks: [...originals].sort(byAdded),
    };
  }
}

/** The spelling the library uses most often, so a stray typo never becomes the label. */
function mostCommon(counts: Map<string, number>): string {
  let best = '';
  let bestCount = -1;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}
