import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import * as https from 'https';
import PQueue from 'p-queue';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';

/** One recording MusicBrainz knows about, reduced to the fields we act on. */
export interface RecordingCandidate {
  artist: string;
  title: string;
  /** ISO date of the earliest release carrying this recording, when known. */
  first_release_date: string | null;
  /** MusicBrainz's own 0-100 match score for the query that found it. */
  score: number;
}

const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [1_000, 3_000];

/**
 * Exact-title matching is what makes a title-only search usable at all. Searching
 * `recording:"Creep"` ranks "Creep Creep" by Flexx G above Radiohead, and
 * `recording:"Lemon"` returns eight obscure bands before 米津玄師 — MusicBrainz
 * scores those 100 because its matching is fuzzy. Dropping everything whose title
 * isn't the queried title removes the noise the score does not.
 */
function normalizeTitle(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * MusicBrainz, used as a source of facts about who a song belongs to.
 *
 * Deliberately never asked to *guess*. A title-only search is fuzzy enough to be
 * actively misleading (see `normalizeTitle`), so nothing here returns a single
 * "the answer" from a title alone: `findCandidates` returns the shortlist for
 * something better-informed to choose from, and `verify` answers one yes/no
 * question about a title/artist pair that a caller already has in hand.
 *
 * Every response is cached in `mb_cache` and every request goes through one
 * shared queue, because MusicBrainz permits one request per second per client
 * and answers a burst with 503s rather than a delay.
 */
@Injectable()
export class MusicBrainzService {
  private readonly logger = new Logger(MusicBrainzService.name);
  private readonly queue = new PQueue({ interval: 1100, intervalCap: 1 });
  private readonly userAgent: string;

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    config: ConfigService,
  ) {
    this.userAgent = config.get<string>('musicbrainz_user_agent', 'podo/0.1.0 ( https://github.com/byeolki/podo )');
  }

  /**
   * Recordings of `title`, best match first, restricted to `artist` when one is
   * supplied. Exists to give a caller real rows to reason over instead of asking
   * it to trust a single fuzzy hit.
   */
  async findCandidates(title: string, artist?: string | null, limit = 8): Promise<RecordingCandidate[]> {
    const wanted = normalizeTitle(title);
    if (!wanted) return [];

    let query = `recording:"${escapeLucene(title)}"`;
    if (artist) {
      // Resolving the artist to an id first is what makes a non-English name work:
      // the library stores 아이유, MusicBrainz files her as IU, and an artist:"아이유"
      // clause matches nothing. The artist search resolves aliases; the id doesn't
      // care which spelling the caller had.
      const mbid = await this.resolveArtistId(artist);
      query += mbid ? ` AND arid:${mbid}` : ` AND artist:"${escapeLucene(artist)}"`;
    }

    const data = await this.get<MbRecordingSearch>('recording', { query, limit: String(limit) });
    if (!data?.recordings) return [];

    return data.recordings
      .filter((r) => normalizeTitle(r.title ?? '') === wanted && (r.score ?? 0) >= 90)
      .map((r) => ({
        artist: (r['artist-credit'] ?? []).map((c) => c.artist?.name).filter(Boolean).join(', '),
        title: r.title ?? title,
        first_release_date: r['first-release-date'] || null,
        score: r.score ?? 0,
      }))
      .filter((c) => !!c.artist);
  }

  /**
   * Does MusicBrainz agree that `artist` recorded `title`? Used to check an answer
   * that came from somewhere else, which is the one question a fuzzy search can
   * answer reliably: a wrong pair returns nothing at all.
   */
  async verify(title: string, artist: string): Promise<RecordingCandidate | null> {
    const candidates = await this.findCandidates(title, artist, 5);
    if (!candidates.length) return null;
    // The earliest release is the one that says whose song it is; later ones are
    // reissues, compilations and live versions of the same recording.
    return candidates.reduce((earliest, c) => (dateKey(c) < dateKey(earliest) ? c : earliest));
  }

  /** MBID for an artist name, resolving aliases and localised spellings. */
  private async resolveArtistId(name: string): Promise<string | null> {
    const data = await this.get<MbArtistSearch>('artist', { query: name, limit: '1' });
    const top = data?.artists?.[0];
    if (!top?.id || (top.score ?? 0) < 90) return null;
    return top.id;
  }

  private async get<T>(entity: 'recording' | 'artist', params: Record<string, string>): Promise<T | null> {
    const search = new URLSearchParams({ ...params, fmt: 'json' });
    const url = `https://musicbrainz.org/ws/2/${entity}/?${search.toString()}`;
    const cacheKey = `mb2:${entity}:${search.toString()}`;

    const cached = await this.db
      .select()
      .from(schema.mb_cache)
      .where(eq(schema.mb_cache.key, cacheKey))
      .get();
    if (cached && Date.now() - cached.fetched_at.getTime() < CACHE_TTL_MS) {
      return cached.data as T;
    }

    const fetched = await this.queue.add(() => this.fetchWithBackoff(url));
    if (fetched === null || fetched === undefined) return (cached?.data as T) ?? null;

    await this.db
      .insert(schema.mb_cache)
      .values({ key: cacheKey, data: fetched as Record<string, unknown>, fetched_at: new Date() })
      .onConflictDoUpdate({
        target: schema.mb_cache.key,
        set: { data: fetched as Record<string, unknown>, fetched_at: new Date() },
      });
    return fetched as T;
  }

  /**
   * A 503 from MusicBrainz means "you are going too fast", not "this is broken" —
   * it is the documented response to exceeding the one-request-per-second budget,
   * and it arrives even when the caller is pacing itself, because the limit is per
   * IP and a self-hosted instance shares one with everything else on the machine.
   * Retrying twice with a widening gap turns the common case back into an answer
   * instead of a silently missing artist.
   */
  private async fetchWithBackoff(url: string): Promise<unknown | null> {
    for (let attempt = 0; ; attempt++) {
      const result = await this.httpGet(url);
      if (result !== RETRYABLE) return result;
      if (attempt >= RETRY_DELAYS_MS.length) {
        this.logger.debug('MusicBrainz still rate-limiting after retries; giving up on this lookup');
        return null;
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }

  private httpGet(url: string): Promise<unknown | null | typeof RETRYABLE> {
    return new Promise((resolve) => {
      const req = https.get(url, { headers: { 'User-Agent': this.userAgent, Accept: 'application/json' } }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300) {
          res.resume();
          this.logger.debug(`MusicBrainz answered HTTP ${status}`);
          resolve(status === 503 || status === 429 ? RETRYABLE : null);
          return;
        }
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
      });
      req.on('error', (e) => {
        this.logger.debug(`MusicBrainz unreachable: ${e.message}`);
        resolve(null);
      });
      req.setTimeout(REQUEST_TIMEOUT_MS, () => { req.destroy(); resolve(null); });
    });
  }
}

/** Distinguishes "slow down and ask again" from "there is no answer here". */
const RETRYABLE = Symbol('musicbrainz-retryable');

/** Undated recordings sort last, so a dated release always wins the reduce. */
function dateKey(c: RecordingCandidate): string {
  return c.first_release_date || '9999';
}

/** Lucene syntax inside a quoted phrase — a stray quote turns the query into a 400. */
function escapeLucene(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

interface MbRecordingSearch {
  recordings?: Array<{
    title?: string;
    score?: number;
    'first-release-date'?: string;
    'artist-credit'?: Array<{ artist?: { name?: string } }>;
  }>;
}

interface MbArtistSearch {
  artists?: Array<{ id?: string; name?: string; score?: number }>;
}
