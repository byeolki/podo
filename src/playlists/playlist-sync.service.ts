import {
  Injectable, Logger, Inject, NotFoundException, ForbiddenException, BadRequestException,
  OnApplicationBootstrap, OnApplicationShutdown,
} from '@nestjs/common';
import { eq, and, isNull, inArray, sql } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { DownloadService } from '../download/download.service';
import { YtdlpService } from '../download/ytdlp.service';
import { EventsService } from '../sync/events.service';
import { providerFor } from '../download/providers';

export interface SubscriptionInput {
  source_url: string;
  interval_minutes?: number;
  audio_only?: boolean;
  enabled?: boolean;
}

const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 60 * 24 * 7;
/** How often the scheduler looks for subscriptions whose interval has elapsed. */
const TICK_MS = 60_000;

/**
 * Keeps a Podo playlist in step with a playlist on an external platform.
 *
 * One-way and additive by design: entries that appear remotely are downloaded and
 * appended, but nothing is ever removed locally. A remote playlist losing a video
 * (deleted, region-locked, privated) shouldn't silently delete the copy you
 * already have — that copy is often the only reason to run this at all.
 *
 * Already-imported entries are recognised by `sources.source_url`, which the
 * downloader records per item, so re-syncing a 500-track playlist costs one
 * `--flat-playlist` listing and nothing else.
 */
@Injectable()
export class PlaylistSyncService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PlaylistSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  /** Playlists with a sync in flight, so a slow run can't overlap itself. */
  private readonly running = new Set<string>();

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly downloads: DownloadService,
    private readonly ytdlp: YtdlpService,
    private readonly events: EventsService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.runDueSubscriptions(), TICK_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async get(playlistId: string, userId: string, isAdmin: boolean) {
    await this.requireOwnerOrAdmin(playlistId, userId, isAdmin);
    return this.db
      .select()
      .from(schema.playlist_subscriptions)
      .where(eq(schema.playlist_subscriptions.playlist_id, playlistId))
      .get() ?? null;
  }

  /**
   * Creates or replaces a playlist's subscription, then syncs immediately so the
   * user sees a result rather than waiting for the first tick.
   */
  async upsert(playlistId: string, dto: SubscriptionInput, userId: string, isAdmin: boolean) {
    await this.requireAdmin(playlistId, userId, isAdmin);

    const url = dto.source_url.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new BadRequestException('Source URL must be an http(s) link');
    }

    const interval = Math.min(
      Math.max(dto.interval_minutes ?? 360, MIN_INTERVAL_MINUTES),
      MAX_INTERVAL_MINUTES,
    );

    const values = {
      playlist_id: playlistId,
      source_url: url,
      provider: providerFor(url),
      audio_only: dto.audio_only ?? true,
      interval_minutes: interval,
      enabled: dto.enabled ?? true,
      created_by: userId,
    };

    await this.db
      .insert(schema.playlist_subscriptions)
      .values(values)
      .onConflictDoUpdate({
        target: schema.playlist_subscriptions.playlist_id,
        set: {
          source_url: values.source_url,
          provider: values.provider,
          audio_only: values.audio_only,
          interval_minutes: values.interval_minutes,
          enabled: values.enabled,
        },
      });

    this.logger.log(`Playlist ${playlistId} subscribed to ${values.provider} ${url} every ${interval}m`);
    void this.sync(playlistId);
    return this.get(playlistId, userId, isAdmin);
  }

  async remove(playlistId: string, userId: string, isAdmin: boolean) {
    await this.requireAdmin(playlistId, userId, isAdmin);
    await this.db
      .delete(schema.playlist_subscriptions)
      .where(eq(schema.playlist_subscriptions.playlist_id, playlistId));
  }

  async syncNow(playlistId: string, userId: string, isAdmin: boolean) {
    await this.requireAdmin(playlistId, userId, isAdmin);
    return this.sync(playlistId);
  }

  /** Fires every tick; picks up whatever is due and runs those sequentially. */
  private async runDueSubscriptions(): Promise<void> {
    try {
      const now = Date.now();
      const subs = await this.db
        .select()
        .from(schema.playlist_subscriptions)
        .where(eq(schema.playlist_subscriptions.enabled, true));

      for (const sub of subs) {
        const dueAt = (sub.last_synced_at?.getTime() ?? 0) + sub.interval_minutes * 60_000;
        if (now < dueAt) continue;
        // Sequential on purpose: each sync can spawn yt-dlp downloads, and running
        // several playlists at once would multiply that against the same CPU.
        await this.sync(sub.playlist_id);
      }
    } catch (e) {
      this.logger.error(`Subscription scheduler failed: ${(e as Error).message}`);
    }
  }

  async sync(playlistId: string): Promise<{ checked: number; added: number; skipped: number; failed: number }> {
    const empty = { checked: 0, added: 0, skipped: 0, failed: 0 };
    if (this.running.has(playlistId)) return empty;

    const sub = await this.db
      .select()
      .from(schema.playlist_subscriptions)
      .where(eq(schema.playlist_subscriptions.playlist_id, playlistId))
      .get();
    if (!sub) return empty;

    this.running.add(playlistId);
    await this.db
      .update(schema.playlist_subscriptions)
      .set({ last_status: 'running', last_error: null })
      .where(eq(schema.playlist_subscriptions.playlist_id, playlistId));
    this.events.emit('playlist.sync.started', { playlist_id: playlistId, source_url: sub.source_url });

    let added = 0;
    let skipped = 0;
    let failed = 0;
    let entries: { id: string; title: string; url: string }[] = [];

    try {
      entries = await this.ytdlp.listPlaylistEntries(sub.source_url);
      if (!entries.length) {
        throw new Error('Remote playlist returned no entries — it may be private, empty or unsupported');
      }

      const known = await this.knownSourceUrls(entries.map((e) => e.url));

      for (const entry of entries) {
        if (known.has(entry.url)) {
          skipped++;
          continue;
        }
        try {
          const importedTrackIds: string[] = [];
          await this.downloads.runToCompletion(entry.url, {
            audioOnly: sub.audio_only,
            // One entry at a time: the listing already expanded the playlist, and
            // letting yt-dlp re-expand it here would re-download everything.
            allowPlaylist: false,
            onTrackImported: async (trackId) => { importedTrackIds.push(trackId); },
          });

          if (importedTrackIds.length) {
            await this.appendTracks(playlistId, importedTrackIds);
            added += importedTrackIds.length;
          } else {
            failed++;
          }
        } catch (e) {
          failed++;
          this.logger.warn(`Sync: failed to import ${entry.url}: ${(e as Error).message}`);
        }
      }

      await this.db
        .update(schema.playlist_subscriptions)
        .set({
          last_synced_at: new Date(),
          last_status: 'ok',
          last_error: failed ? `${failed} entr${failed === 1 ? 'y' : 'ies'} could not be imported` : null,
          added_count: sql`${schema.playlist_subscriptions.added_count} + ${added}`,
        })
        .where(eq(schema.playlist_subscriptions.playlist_id, playlistId));

      this.logger.log(`Playlist ${playlistId} synced: +${added}, ${skipped} already present, ${failed} failed`);
      this.events.emit('playlist.sync.completed', { playlist_id: playlistId, added, skipped, failed });
    } catch (e) {
      const message = (e as Error).message;
      await this.db
        .update(schema.playlist_subscriptions)
        .set({ last_synced_at: new Date(), last_status: 'failed', last_error: message })
        .where(eq(schema.playlist_subscriptions.playlist_id, playlistId));
      this.logger.error(`Playlist ${playlistId} sync failed: ${message}`);
      this.events.emit('playlist.sync.failed', { playlist_id: playlistId, error: message });
    } finally {
      this.running.delete(playlistId);
    }

    return { checked: entries.length, added, skipped, failed };
  }

  /** Which of these remote URLs already exist as a source in the library. */
  private async knownSourceUrls(urls: string[]): Promise<Set<string>> {
    if (!urls.length) return new Set();
    const found = new Set<string>();
    // Chunked to stay clear of SQLite's bound-parameter ceiling on big playlists.
    for (let i = 0; i < urls.length; i += 400) {
      const rows = await this.db
        .select({ source_url: schema.sources.source_url })
        .from(schema.sources)
        .where(and(isNull(schema.sources.deleted_at), inArray(schema.sources.source_url, urls.slice(i, i + 400))));
      for (const row of rows) if (row.source_url) found.add(row.source_url);
    }
    return found;
  }

  private async appendTracks(playlistId: string, trackIds: string[]): Promise<void> {
    const existing = await this.db
      .select({ track_id: schema.playlist_tracks.track_id })
      .from(schema.playlist_tracks)
      .where(eq(schema.playlist_tracks.playlist_id, playlistId));
    const present = new Set(existing.map((r) => r.track_id));

    const toAdd = trackIds.filter((id) => !present.has(id));
    if (!toAdd.length) return;

    const maxPos = await this.db.all<{ pos: number | null }>(
      sql`SELECT MAX(position) as pos FROM playlist_tracks WHERE playlist_id = ${playlistId}`,
    );
    const base = (maxPos[0]?.pos ?? -1) + 1;

    await this.db
      .insert(schema.playlist_tracks)
      .values(toAdd.map((track_id, i) => ({ playlist_id: playlistId, track_id, position: base + i })))
      .onConflictDoNothing();

    await this.db
      .update(schema.playlists)
      .set({ updated_at: new Date() })
      .where(eq(schema.playlists.id, playlistId));
  }

  /** Reading whether a playlist is linked is open to whoever owns it. */
  private async requireOwnerOrAdmin(playlistId: string, userId: string, isAdmin: boolean): Promise<void> {
    const playlist = await this.loadPlaylist(playlistId);
    if (playlist.owner_user_id !== userId && !isAdmin) throw new ForbiddenException();
  }

  /**
   * Changing or running a subscription pulls files onto the server, which is an
   * admin capability everywhere else in the API (`POST /download` is admin-only),
   * so owning the playlist isn't enough on its own.
   */
  private async requireAdmin(playlistId: string, userId: string, isAdmin: boolean): Promise<void> {
    const playlist = await this.loadPlaylist(playlistId);
    if (!isAdmin) throw new ForbiddenException('Playlist auto-sync downloads media, which is admin-only');
    if (playlist.owner_user_id !== userId && !isAdmin) throw new ForbiddenException();
  }

  private async loadPlaylist(playlistId: string) {
    const playlist = await this.db
      .select({ owner_user_id: schema.playlists.owner_user_id })
      .from(schema.playlists)
      .where(and(eq(schema.playlists.id, playlistId), isNull(schema.playlists.deleted_at)))
      .get();
    if (!playlist) throw new NotFoundException('Playlist not found');
    return playlist;
  }
}
