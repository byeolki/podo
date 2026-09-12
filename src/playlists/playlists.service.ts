import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and, asc, isNull, sql } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { newId } from '../common/id';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { TracksService } from '../tracks/tracks.service';
import { DownloadService } from '../download/download.service';
import { YtdlpService } from '../download/ytdlp.service';

const ALLOWED_COVER_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_COVER_SIZE = 10 * 1024 * 1024;

@Injectable()
export class PlaylistsService {
  private readonly artworkDir: string;

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly config: ConfigService,
    private readonly tracks: TracksService,
    private readonly download: DownloadService,
    private readonly ytdlp: YtdlpService,
  ) {
    this.artworkDir = config.get<string>('artwork_dir', path.join(process.cwd(), 'data', 'artwork'));
    fs.mkdirSync(this.artworkDir, { recursive: true });
  }

  findAll(userId: string) {
    return this.db
      .select()
      .from(schema.playlists)
      .where(and(eq(schema.playlists.owner_user_id, userId), isNull(schema.playlists.deleted_at)));
  }

  findPublic() {
    return this.db
      .select()
      .from(schema.playlists)
      .where(and(eq(schema.playlists.is_public, true), isNull(schema.playlists.deleted_at)));
  }

  async findOne(id: string, userId: string) {
    const playlist = await this.db
      .select()
      .from(schema.playlists)
      .where(and(eq(schema.playlists.id, id), isNull(schema.playlists.deleted_at)))
      .get();
    if (!playlist) throw new NotFoundException('Playlist not found');
    if (playlist.owner_user_id !== userId && !playlist.is_public) throw new ForbiddenException();

    const rows = await this.db
      .select({ track_id: schema.playlist_tracks.track_id, position: schema.playlist_tracks.position })
      .from(schema.playlist_tracks)
      .where(eq(schema.playlist_tracks.playlist_id, id))
      .orderBy(asc(schema.playlist_tracks.position));

    // findByIds resolves title/artist/is_cover overrides the same way the library list
    // does — a plain `tracks` select (the old query here) skipped that entirely, so an
    // edited track's title/artist silently reverted to the raw scanned filename inside
    // any playlist.
    const enriched = await this.tracks.findByIds(rows.map((r) => r.track_id), userId);
    const byId = new Map(enriched.map((t) => [t.id, t]));
    const tracks = rows
      .map((r) => {
        const track = byId.get(r.track_id);
        return track ? { ...track, position: r.position } : null;
      })
      .filter((t): t is NonNullable<typeof t> => !!t);

    return { ...playlist, tracks };
  }

  async create(dto: { name: string; description?: string; is_public?: boolean }, userId: string) {
    const id = newId();
    await this.db.insert(schema.playlists).values({
      id,
      owner_user_id: userId,
      name: dto.name,
      description: dto.description,
      is_public: dto.is_public ?? false,
    });
    return this.db.select().from(schema.playlists).where(eq(schema.playlists.id, id)).get();
  }

  /**
   * Downloads a remote playlist and keeps it as one: the tracks land in the
   * library the way any download does, and a local playlist is created holding
   * them in the order they arrived.
   *
   * Without this, pasting a playlist URL scattered fifty tracks into the library
   * with nothing recording that they belonged together. This is a one-time
   * import and nothing more — the playlist is an ordinary playlist afterwards,
   * with no link back to the source. Subscribing a playlist to keep pulling new
   * items is a separate, deliberate action (see `PlaylistSyncService`).
   *
   * Returns as soon as the job is queued; progress arrives on the usual
   * `download.*` events, and tracks appear in the playlist as they import.
   */
  async createFromUrl(
    url: string,
    userId: string,
    isAdmin: boolean,
    opts: { audioOnly?: boolean; name?: string } = {},
  ) {
    // Same gate as `POST /download` and playlist auto-sync: this spends disk and
    // bandwidth and reaches out to a third-party site, so it stays an admin
    // action even though the playlist it produces is an ordinary user playlist.
    if (!isAdmin) throw new ForbiddenException('Only an admin can download from a URL');

    // Read the playlist before creating anything. A private, deleted or mistyped
    // URL otherwise left an empty playlist sitting in the library after the
    // download failed, with nothing to say why.
    const probe = await this.ytdlp.probePlaylist(url);
    if (!probe || probe.count === 0) {
      throw new BadRequestException(
        "Couldn't read that playlist — check the link is correct and the playlist is public",
      );
    }

    const given = opts.name?.trim();
    const name = given || probe.title || 'Imported playlist';
    const playlist = await this.create({ name, description: `Imported from ${url}` }, userId);
    if (!playlist) throw new BadRequestException('Could not create the playlist');

    const job = await this.download.start(url, opts.audioOnly ?? true, {
      // The URL was chosen *because* it names a collection, so never let the
      // "is this one item or a list?" heuristic decide here.
      allowPlaylist: true,
      // Placed by the item's position in the source playlist, not by when it
      // finished: imports run concurrently, so appending on arrival shuffled the
      // order (a three-track list imported as 2, 1, 3). Writing each row at its
      // own position also lets the playlist fill in visibly while the download
      // is still running.
      onTrackImported: async (trackId, _sourceUrl, index) => {
        await this.placeTrack(playlist.id, trackId, index);
      },
    });

    return { playlist_id: playlist.id, name: playlist.name, job_id: job.id };
  }

  /**
   * Writes one track at a known position. Only used while importing, where the
   * positions come from the source playlist and the rows arrive out of order —
   * `addTracks` appends at the end, which is the wrong shape for that.
   */
  private async placeTrack(playlistId: string, trackId: string, position: number) {
    await this.db
      .insert(schema.playlist_tracks)
      .values({ playlist_id: playlistId, track_id: trackId, position })
      .onConflictDoNothing();
    await this.db
      .update(schema.playlists)
      .set({ updated_at: new Date() })
      .where(eq(schema.playlists.id, playlistId));
  }

  async update(id: string, dto: { name?: string; description?: string; is_public?: boolean; track_ids?: string[] }, userId: string) {
    await this.requireOwner(id, userId);

    if (dto.name || dto.description !== undefined || dto.is_public !== undefined) {
      await this.db.update(schema.playlists).set({
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.is_public !== undefined && { is_public: dto.is_public }),
        updated_at: new Date(),
      }).where(eq(schema.playlists.id, id));
    }

    if (dto.track_ids) {
      await this.db.delete(schema.playlist_tracks).where(eq(schema.playlist_tracks.playlist_id, id));
      if (dto.track_ids.length) {
        await this.db.insert(schema.playlist_tracks).values(
          dto.track_ids.map((track_id, i) => ({ playlist_id: id, track_id, position: i })),
        ).onConflictDoNothing();
      }
    }

    return this.findOne(id, userId);
  }

  async addTracks(id: string, trackIds: string[], userId: string) {
    await this.requireOwner(id, userId);
    if (!trackIds.length) return;

    const maxPos = await this.db.all<{ pos: number | null }>(
      sql`SELECT MAX(position) as pos FROM playlist_tracks WHERE playlist_id = ${id}`,
    );
    const base = (maxPos[0]?.pos ?? -1) + 1;

    await this.db.insert(schema.playlist_tracks).values(
      trackIds.map((track_id, i) => ({ playlist_id: id, track_id, position: base + i })),
    ).onConflictDoNothing();

    await this.db.update(schema.playlists).set({ updated_at: new Date() }).where(eq(schema.playlists.id, id));
  }

  async remove(id: string, userId: string) {
    await this.requireOwner(id, userId);
    await this.db.update(schema.playlists).set({ deleted_at: new Date() }).where(eq(schema.playlists.id, id));
  }

  async setCover(id: string, filename: string, fileStream: Readable, userId: string) {
    const playlist = await this.requireOwner(id, userId);

    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_COVER_EXTS.has(ext)) throw new BadRequestException(`Unsupported image type: ${ext}`);

    const destPath = path.join(this.artworkDir, `playlist_${id}_${Date.now()}${ext}`);
    await pipeline(fileStream, fs.createWriteStream(destPath));

    const stat = fs.statSync(destPath);
    if (stat.size > MAX_COVER_SIZE) {
      fs.unlinkSync(destPath);
      throw new BadRequestException('Image too large (max 10MB)');
    }

    this.deleteArtworkFile(playlist.artwork_path);
    await this.db.update(schema.playlists).set({ artwork_path: destPath, updated_at: new Date() }).where(eq(schema.playlists.id, id));
    return { artwork_path: destPath };
  }

  async removeCover(id: string, userId: string) {
    const playlist = await this.requireOwner(id, userId);
    this.deleteArtworkFile(playlist.artwork_path);
    await this.db.update(schema.playlists).set({ artwork_path: null, updated_at: new Date() }).where(eq(schema.playlists.id, id));
  }

  private deleteArtworkFile(artworkPath: string | null): void {
    if (!artworkPath) return;
    try {
      fs.unlinkSync(artworkPath);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }

  private async requireOwner(id: string, userId: string) {
    const playlist = await this.db.select().from(schema.playlists).where(eq(schema.playlists.id, id)).get();
    if (!playlist) throw new NotFoundException('Playlist not found');
    if (playlist.owner_user_id !== userId) throw new ForbiddenException();
    return playlist;
  }
}
