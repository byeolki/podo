import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and, like, inArray } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { FfprobeService } from './ffprobe.service';
import { MetadataService } from './metadata.service';
import { EventsService } from '../sync/events.service';
import { AiService } from '../ai/ai.service';
import { newId } from '../common/id';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import PQueue from 'p-queue';

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.flac', '.aac', '.wav', '.ogg', '.opus']);
const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.mkv']);
const SUPPORTED_EXTS = new Set([...AUDIO_EXTS, ...VIDEO_EXTS]);

const PROGRESS_EVERY = 50;

function mediaKind(ext: string): 'audio' | 'video' | null {
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

/**
 * The part of a filename that decides whether two files are the same track.
 *
 * Uploads are stored as `<epoch-ms>_<name>`, and the timestamp is taken per file
 * — so `song.m4a` and `song.mp4` uploaded separately became `1789001_song.m4a`
 * and `1789002_song.mp4`. Compared raw they are two different stems, so the pair
 * was never found and one track arrived as two. The CLI already strips the same
 * prefix when deciding what is already uploaded.
 */
export function pairingStem(stem: string): string {
  return stem.replace(/^\d{10,}_/, '');
}

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);
  private readonly scanQueue = new PQueue({ concurrency: 4 });
  private activeScanJobId: string | null = null;
  private readonly artworkDir: string;

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly ffprobe: FfprobeService,
    private readonly metadata: MetadataService,
    private readonly events: EventsService,
    private readonly config: ConfigService,
    private readonly ai: AiService,
  ) {
    this.artworkDir = config.get<string>('artwork_dir', path.join(process.cwd(), 'data', 'artwork'));
    fs.mkdirSync(this.artworkDir, { recursive: true });
  }

  async scanRoot(libraryRootId: string, rootPath: string): Promise<string> {
    const jobId = newId();
    await this.db.insert(schema.scan_jobs).values({
      id: jobId,
      library_root_id: libraryRootId,
      status: 'running',
    });

    this.activeScanJobId = jobId;
    this.events.emit('scan.started', { job_id: jobId, root: rootPath });

    setImmediate(() => this.runScan(jobId, libraryRootId, rootPath));
    return jobId;
  }

  /**
   * `force` re-probes and re-derives the sidecars (thumbnail, subtitles) even when
   * the file looks unchanged. Used by a source refresh: the point of re-downloading
   * is to pick up whatever changed upstream, and an unchanged media file can still
   * arrive with a new thumbnail or newly-added subtitles.
   */
  async scanFile(
    filePath: string,
    origin: 'local' | 'ytdlp' = 'local',
    sourceUrl?: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const kind = mediaKind(path.extname(filePath).toLowerCase());
    if (!kind) return;

    try {
      await this.scanQueue.add(() => this.upsertSource(filePath, kind, origin, sourceUrl, opts.force ?? false));
    } catch (e) {
      this.logger.error(
        `Failed to scan ${filePath}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  async removeFile(filePath: string): Promise<void> {
    try {
      const source = await this.db
        .select()
        .from(schema.sources)
        .where(eq(schema.sources.locator, filePath))
        .get();

      if (!source) return;

      await this.db
        .update(schema.sources)
        .set({ available: false, deleted_at: new Date(), updated_at: new Date() })
        .where(eq(schema.sources.id, source.id));

      this.events.emit('source.removed', { source_id: source.id, track_id: source.track_id });
    } catch (e) {
      this.logger.error(
        `Failed to remove ${filePath}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  private async runScan(jobId: string, libraryRootId: string, rootPath: string): Promise<void> {
    try {
      // `walkDir` already filters to supported extensions, so every entry here has
      // a media kind.
      const files = this.walkDir(rootPath);
      const total = files.length;

      await this.db
        .update(schema.scan_jobs)
        .set({ total_files: total })
        .where(eq(schema.scan_jobs.id, jobId));

      let processed = 0;
      let added = 0;
      let updated = 0;

      // Handed to the queue as a whole rather than awaited one at a time: ffprobe
      // (and, when enabled, the AI metadata call) dominates per-file cost and is
      // mostly waiting, so the queue's concurrency is what makes a scan finish in
      // reasonable time on a large library.
      const scanOne = async (filePath: string): Promise<void> => {
        try {
          const kind = mediaKind(path.extname(filePath).toLowerCase())!;
          const result = await this.upsertSource(filePath, kind);
          if (result === 'added') added++;
          else if (result === 'updated') updated++;
        } catch (e) {
          this.logger.warn(
            `Failed to scan ${filePath}`,
            e instanceof Error ? e.stack : String(e),
          );
        }

        processed++;
        if (processed % PROGRESS_EVERY === 0) {
          await this.db
            .update(schema.scan_jobs)
            .set({ processed_files: processed, added, updated })
            .where(eq(schema.scan_jobs.id, jobId));

          this.events.emit('scan.progress', {
            job_id: jobId,
            total,
            processed,
            added,
            updated,
          });
        }
      };

      await Promise.all(files.map((filePath) => this.scanQueue.add(() => scanOne(filePath))));

      await this.markMissingUnavailable(rootPath);

      await this.db
        .update(schema.scan_jobs)
        .set({
          status: 'completed',
          processed_files: processed,
          added,
          updated,
          finished_at: new Date(),
        })
        .where(eq(schema.scan_jobs.id, jobId));

      await this.db
        .update(schema.library_roots)
        .set({ last_scan_at: new Date() })
        .where(eq(schema.library_roots.id, libraryRootId));

      this.events.emit('scan.completed', { job_id: jobId, total, added, updated });
    } catch (e) {
      await this.db
        .update(schema.scan_jobs)
        .set({
          status: 'failed',
          error: String(e),
          finished_at: new Date(),
        })
        .where(eq(schema.scan_jobs.id, jobId));

      this.events.emit('scan.failed', { job_id: jobId, error: String(e) });
    } finally {
      this.activeScanJobId = null;
    }
  }

  private async upsertSource(
    filePath: string,
    kind: 'audio' | 'video',
    origin: 'local' | 'ytdlp' = 'local',
    sourceUrl?: string,
    force = false,
  ): Promise<'added' | 'updated' | 'skipped'> {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return 'skipped';
    }

    const existing = await this.db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.locator, filePath))
      .get();

    const fileHash = this.hashFile(filePath);

    // A rescan of an untouched library shouldn't re-probe (and re-AI) everything.
    // Size plus a hash of the leading bytes is enough to spot a real change and is
    // orders of magnitude cheaper than spawning ffprobe. (An earlier version
    // compared the file's mtime against the row's `updated_at` — the row's write
    // time, not the file's — which never matched, so nothing was ever skipped.)
    if (
      !force &&
      existing &&
      existing.available &&
      !existing.deleted_at &&
      existing.file_size === stat.size &&
      existing.file_hash === fileHash &&
      fileHash !== ''
    ) {
      // Unchanged on disk, but the *track* may still be soft-deleted: deleting
      // a track leaves its source row untouched, so this branch is exactly the
      // one a re-scan takes for it, and returning here is why a deleted track
      // never came back no matter how many times the library was scanned.
      await this.reviveTrackIfDeleted(existing.track_id);
      return 'skipped';
    }

    const probe = await this.ffprobe.probe(filePath);
    if (!probe) return 'skipped';

    const meta = this.metadata.parseTags(probe);

    let isCover = false;
    let aiOverride: {
      title?: string;
      artist?: string;
      is_cover?: boolean;
      original_artist?: string;
    } | null = null;

    // Only for a file we haven't seen before. Re-scanning a known file re-derives
    // nothing useful — the filename it reasons from hasn't changed — and the
    // result was being thrown away anyway, so every re-import of a changed file
    // was paying for an LLM call whose answer went nowhere.
    if (!existing && (await this.ai.isUsable())) {
      const aiResult = await this.ai.extractMetadata(path.basename(filePath), {
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        genre: meta.genres.join(', ') || null,
      });
      if (aiResult) {
        if (!meta.title && aiResult.title) meta.title = aiResult.title;
        if (!meta.artist && aiResult.artist) meta.artist = aiResult.artist;
        if (!meta.album && aiResult.album) meta.album = aiResult.album;
        if (!meta.year && aiResult.year) meta.year = aiResult.year;
        if (!meta.genres.length && aiResult.genres.length) meta.genres = aiResult.genres;
        isCover = aiResult.is_cover;
        aiOverride = {
          title: aiResult.title ?? undefined,
          artist: aiResult.artist ?? undefined,
          is_cover: aiResult.is_cover,
          original_artist: aiResult.original_artist ?? undefined,
        };
      }
    }

    // `pairingStem` here too, not just when pairing: an upload is stored as
    // `<epoch-ms>_<name>`, so a file with no title tag was named after the
    // storage detail — 109 tracks titled `1789233124120_song`.
    const title = meta.title ?? pairingStem(path.basename(filePath, path.extname(filePath)));

    let albumVersionId: string | null = null;
    if (meta.album) {
      albumVersionId = await this.metadata.resolveOrCreateAlbumVersion(meta.album, meta.year);
      if (probe.has_embedded_art) {
        await this.maybeSetAlbumArtwork(albumVersionId, filePath);
      }
    }

    if (!existing) {
      const siblingTrackId = await this.findSiblingTrackId(filePath);
      if (siblingTrackId) {
        await this.db
          .insert(schema.sources)
          .values({
            id: newId(),
            track_id: siblingTrackId,
            media_kind: kind,
            origin,
            format: probe.format,
            codec: probe.codec,
            bitrate: probe.bitrate ?? undefined,
            sample_rate: probe.sample_rate ?? undefined,
            channels: probe.channels ?? undefined,
            duration: probe.duration ?? undefined,
            locator: filePath,
            file_hash: fileHash,
            file_size: stat.size,
            source_url: sourceUrl,
          })
          .onConflictDoNothing();
        // The sibling path used to discard this. Uploading the video for a track
        // that already had its audio meant paying for the metadata guess and
        // then dropping it. `onConflictDoNothing` keeps it from ever touching an
        // override a person has already written.
        if (aiOverride) await this.saveAiOverride(siblingTrackId, aiOverride);

        this.events.emit('track.upserted', { track_id: siblingTrackId });
        await this.maybeSetThumbnail(siblingTrackId, filePath, kind, origin, force, probe.duration ?? null);
        await this.maybeSetLyrics(siblingTrackId, filePath, origin);
        return 'added';
      }
    }

    if (existing) {
      const trackId = existing.track_id;

      await this.db
        .update(schema.tracks)
        .set({
          title,
          artist: meta.artist ?? undefined,
          album_version_id: albumVersionId ?? undefined,
          track_number: meta.track_number ?? undefined,
          disc_number: meta.disc_number ?? undefined,
          canonical_duration: probe.duration ?? undefined,
          is_cover: isCover,
          // The source below is revived too, but nothing anywhere cleared this,
          // so a track soft-deleted once stayed invisible even after its file
          // came back and rescanned — with no way to undo it from the UI or the
          // API either.
          deleted_at: null,
          updated_at: new Date(),
        })
        .where(eq(schema.tracks.id, trackId));

      await this.db
        .update(schema.sources)
        .set({
          format: probe.format,
          codec: probe.codec,
          bitrate: probe.bitrate ?? undefined,
          sample_rate: probe.sample_rate ?? undefined,
          channels: probe.channels ?? undefined,
          duration: probe.duration ?? undefined,
          replaygain_track: probe.replaygain_track ?? undefined,
          replaygain_album: probe.replaygain_album ?? undefined,
          file_hash: fileHash,
          file_size: stat.size,
          available: true,
          deleted_at: null,
          updated_at: new Date(),
          source_url: sourceUrl ?? undefined,
        })
        .where(eq(schema.sources.id, existing.id));

      this.events.emit('track.upserted', { track_id: trackId });
      await this.maybeSetThumbnail(trackId, filePath, kind, origin, force, probe.duration ?? null);
      await this.maybeSetLyrics(trackId, filePath, origin);
      return 'updated';
    }

    const trackId = newId();
    await this.db.insert(schema.tracks).values({
      id: trackId,
      title,
      artist: meta.artist ?? undefined,
      album_version_id: albumVersionId ?? undefined,
      track_number: meta.track_number ?? undefined,
      disc_number: meta.disc_number ?? undefined,
      canonical_duration: probe.duration ?? undefined,
      is_cover: isCover,
    });

    if (meta.genres.length) {
      const tagIds = await this.metadata.ensureGenres(meta.genres);
      for (const tagId of tagIds) {
        await this.db
          .insert(schema.track_tags)
          .values({ track_id: trackId, tag_id: tagId })
          .onConflictDoNothing();
      }
    }

    await this.db.insert(schema.sources).values({
      id: newId(),
      track_id: trackId,
      media_kind: kind,
      origin,
      format: probe.format,
      codec: probe.codec,
      bitrate: probe.bitrate ?? undefined,
      sample_rate: probe.sample_rate ?? undefined,
      channels: probe.channels ?? undefined,
      duration: probe.duration ?? undefined,
      replaygain_track: probe.replaygain_track ?? undefined,
      replaygain_album: probe.replaygain_album ?? undefined,
      locator: filePath,
      file_hash: fileHash,
      file_size: stat.size,
      source_url: sourceUrl,
    });

    if (aiOverride) await this.saveAiOverride(trackId, aiOverride);

    this.events.emit('track.upserted', { track_id: trackId });
    await this.maybeSetThumbnail(trackId, filePath, kind, origin, force, probe.duration ?? null);
    await this.maybeSetLyrics(trackId, filePath, origin);
    return 'added';
  }

  /**
   * Clears `tracks.deleted_at` when the file behind it is present again.
   *
   * Nothing else in the codebase ever cleared it, so a soft delete was in
   * practice permanent — there is no undelete in the UI or the API either.
   * Rescanning the file it came from is the one signal that says it should be
   * back.
   */
  private async reviveTrackIfDeleted(trackId: string): Promise<void> {
    const track = await this.db
      .select({ deleted_at: schema.tracks.deleted_at })
      .from(schema.tracks)
      .where(eq(schema.tracks.id, trackId))
      .get();
    if (!track?.deleted_at) return;

    await this.db
      .update(schema.tracks)
      .set({ deleted_at: null, updated_at: new Date() })
      .where(eq(schema.tracks.id, trackId));
    this.logger.log(`Revived soft-deleted track ${trackId} — its file is back`);
    this.events.emit('track.upserted', { track_id: trackId });
  }

  /** Never overwrites an override that already exists — a person's edit wins. */
  private async saveAiOverride(
    trackId: string,
    aiOverride: { title?: string; artist?: string; is_cover?: boolean; original_artist?: string },
  ): Promise<void> {
    await this.db
      .insert(schema.track_metadata_overrides)
      .values({
        track_id: trackId,
        title: aiOverride.title ?? null,
        artist: aiOverride.artist ?? null,
        is_cover: aiOverride.is_cover ?? false,
        original_artist: aiOverride.original_artist ?? null,
        updated_at: new Date(),
      })
      .onConflictDoNothing();
  }

  /**
   * Copies a file's embedded cover art onto its album version, once. Most tagged
   * libraries carry art this way — it's the common case, more so than the yt-dlp
   * sidecar or the extracted video frame handled below — and without it an
   * otherwise fully-scanned library shows placeholder tiles everywhere.
   *
   * First writer wins: albums are shared by many files and re-extracting per
   * track would be pure churn.
   */
  private async maybeSetAlbumArtwork(albumVersionId: string, mediaFilePath: string): Promise<void> {
    const version = await this.db
      .select({ artwork_path: schema.album_versions.artwork_path })
      .from(schema.album_versions)
      .where(eq(schema.album_versions.id, albumVersionId))
      .get();
    if (version?.artwork_path && fs.existsSync(version.artwork_path)) return;

    const dest = path.join(this.artworkDir, `album_${albumVersionId}.jpg`);
    try {
      await this.extractEmbeddedArt(mediaFilePath, dest);
      await this.db
        .update(schema.album_versions)
        .set({ artwork_path: dest, updated_at: new Date() })
        .where(eq(schema.album_versions.id, albumVersionId));
    } catch (e) {
      this.logger.warn(`Failed to extract cover art from ${mediaFilePath}`, e instanceof Error ? e.stack : String(e));
    }
  }

  /** `-map 0:v` selects the attached picture; audio is dropped with `-vn`'s inverse. */
  private extractEmbeddedArt(mediaFilePath: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', ['-y', '-i', mediaFilePath, '-an', '-map', '0:v', '-frames:v', '1', '-q:v', '3', dest]);
      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(dest)) resolve();
        else reject(new Error(stderr.slice(-300)));
      });
      proc.on('error', reject);
    });
  }

  // Skip if the track already has one — yt-dlp's own thumbnail (downloaded
  // alongside the media as a same-basename sidecar) always wins over a
  // ffmpeg-extracted video frame, and neither should be regenerated on
  // every rescan.
  private async maybeSetThumbnail(
    trackId: string,
    mediaFilePath: string,
    kind: 'audio' | 'video',
    origin: 'local' | 'ytdlp',
    force = false,
    durationMs: number | null = null,
  ): Promise<void> {
    const track = await this.db
      .select({ thumbnail_path: schema.tracks.thumbnail_path })
      .from(schema.tracks)
      .where(eq(schema.tracks.id, trackId))
      .get();
    // `force` is a source refresh asking for the upstream thumbnail as it is now.
    // Existence matters, not just the column: a path that no longer resolves —
    // the artwork directory moved, the volume was recreated, the file was removed
    // — otherwise pins the track to a permanent placeholder, because nothing ever
    // looks at it again. `maybeSetAlbumArtwork` has always checked this; track
    // thumbnails didn't.
    if (track?.thumbnail_path && !force && fs.existsSync(track.thumbnail_path)) return;

    const dest = path.join(this.artworkDir, `track_${trackId}_thumb.jpg`);

    if (origin === 'ytdlp') {
      const sidecar = path.join(
        path.dirname(mediaFilePath),
        path.basename(mediaFilePath, path.extname(mediaFilePath)) + '.jpg',
      );
      if (fs.existsSync(sidecar)) {
        try {
          fs.copyFileSync(sidecar, dest);
          fs.unlinkSync(sidecar);
          await this.db
            .update(schema.tracks)
            .set({ thumbnail_path: dest })
            .where(eq(schema.tracks.id, trackId));
        } catch (e) {
          this.logger.warn(`Failed to store yt-dlp thumbnail for track ${trackId}`, e instanceof Error ? e.stack : String(e));
        }
        return;
      }
    }

    if (kind === 'video') {
      try {
        await this.extractPosterFrame(mediaFilePath, dest, durationMs);
        await this.db
          .update(schema.tracks)
          .set({ thumbnail_path: dest })
          .where(eq(schema.tracks.id, trackId));
      } catch (e) {
        this.logger.warn(`Failed to extract thumbnail frame for ${mediaFilePath}`, e instanceof Error ? e.stack : String(e));
      }
    }
  }

  /**
   * Grabs a representative still from a video.
   *
   * Taking frame 0 — which is what this did — is how tracks ended up with solid
   * black thumbnails: a music video almost always opens on a fade-in from black,
   * or on a title card. Seeking ~15% in lands in actual content, and ffmpeg's
   * `thumbnail` filter then picks the most representative frame of the batch it
   * sees from there rather than whatever single frame the seek happened to hit.
   *
   * Falls back to the old behaviour if the seek finds nothing, which is what
   * happens on a clip shorter than the offset or a file with a broken index.
   */
  private async extractPosterFrame(
    videoPath: string,
    dest: string,
    durationMs: number | null,
  ): Promise<void> {
    const seekSeconds = durationMs && durationMs > 0
      ? Math.min(Math.max((durationMs / 1000) * 0.15, 2), 120)
      : 10;
    try {
      await this.runFrameGrab(videoPath, dest, seekSeconds);
    } catch {
      await this.runFrameGrab(videoPath, dest, null);
    }
  }

  /**
   * Regenerates one track's thumbnail from its best on-disk video source,
   * ignoring whatever it has now. Used by the admin rebuild action to repair
   * thumbnails produced before the poster-frame change, which came out black.
   *
   * Returns false when there's nothing local to generate from — a track whose
   * only source is audio has to be re-fetched from its URL instead.
   */
  async rebuildTrackThumbnail(trackId: string): Promise<boolean> {
    const video = await this.db
      .select({ locator: schema.sources.locator, duration: schema.sources.duration })
      .from(schema.sources)
      .where(and(
        eq(schema.sources.track_id, trackId),
        eq(schema.sources.media_kind, 'video'),
        eq(schema.sources.available, true),
      ))
      .orderBy(schema.sources.priority)
      .get();
    if (!video || !fs.existsSync(video.locator)) return false;

    const dest = path.join(this.artworkDir, `track_${trackId}_thumb.jpg`);
    try {
      await this.extractPosterFrame(video.locator, dest, video.duration ?? null);
      await this.db
        .update(schema.tracks)
        .set({ thumbnail_path: dest })
        .where(eq(schema.tracks.id, trackId));
      return true;
    } catch (e) {
      this.logger.warn(`Failed to rebuild thumbnail for ${trackId}`, e instanceof Error ? e.stack : String(e));
      return false;
    }
  }

  /**
   * True when an image is effectively a blank rectangle — which is what frame-0
   * extraction produced for any video that opens on a fade-in.
   *
   * Scaling to a single pixel with the `area` flag is an exact mean, so this
   * costs one short ffmpeg call and no decoding of our own.
   */
  async isBlankImage(imagePath: string): Promise<boolean> {
    if (!fs.existsSync(imagePath)) return true;
    const luma = await new Promise<number | null>((resolve) => {
      const proc = spawn('ffmpeg', [
        '-v', 'error', '-i', imagePath,
        '-vf', 'scale=1:1', '-sws_flags', 'area',
        '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
      ]);
      const chunks: Buffer[] = [];
      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      proc.on('close', () => {
        const buf = Buffer.concat(chunks);
        resolve(buf.length ? buf[0] : null);
      });
      proc.on('error', () => resolve(null));
    });
    // A real cover can be very dark; this threshold is for images with no
    // content at all, not for dark ones.
    return luma !== null && luma <= 6;
  }

  private runFrameGrab(videoPath: string, dest: string, seekSeconds: number | null): Promise<void> {
    return new Promise((resolve, reject) => {
      // `-ss` before `-i` so ffmpeg seeks by keyframe rather than decoding up to
      // the offset — the difference is milliseconds against seconds on a long file.
      const args = [
        '-y',
        ...(seekSeconds === null ? [] : ['-ss', seekSeconds.toFixed(2)]),
        '-i', videoPath,
        ...(seekSeconds === null ? [] : ['-vf', 'thumbnail']),
        '-frames:v', '1', '-update', '1', '-q:v', '3',
        dest,
      ];
      const proc = spawn('ffmpeg', args);
      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 0) resolve();
        else reject(new Error(stderr.slice(-300)));
      });
      proc.on('error', reject);
    });
  }

  // yt-dlp downloads only manually-uploaded subtitle tracks (--write-subs,
  // never --write-auto-subs): auto-generated captions are ASR transcripts
  // and too unreliable to present as lyrics. Manual ones are frequently the
  // actual timed lyrics for official audio/lyric-video uploads. Every
  // available language is kept — this is a shared multi-user deployment,
  // not tied to any one language.
  private async maybeSetLyrics(trackId: string, mediaFilePath: string, origin: 'local' | 'ytdlp'): Promise<void> {
    if (origin !== 'ytdlp') return;

    const dir = path.dirname(mediaFilePath);
    const stem = path.basename(mediaFilePath, path.extname(mediaFilePath));
    const vttPrefix = `${stem}.`;

    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }

    const vttFiles = entries.filter((f) => f.startsWith(vttPrefix) && f.endsWith('.vtt'));

    for (const file of vttFiles) {
      const fullPath = path.join(dir, file);
      const language = file.slice(vttPrefix.length, -'.vtt'.length) || 'und';

      try {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const content = this.parseVttToLrc(raw);
        if (content) {
          const existing = await this.db
            .select({ source: schema.lyrics.source })
            .from(schema.lyrics)
            .where(and(eq(schema.lyrics.track_id, trackId), eq(schema.lyrics.language, language)))
            .get();

          // A user-supplied translation is never overwritten by a re-download.
          if (!existing || existing.source !== 'user') {
            await this.db
              .insert(schema.lyrics)
              .values({ track_id: trackId, language, type: 'synced', content, source: 'local', updated_at: new Date() })
              .onConflictDoUpdate({
                target: [schema.lyrics.track_id, schema.lyrics.language],
                set: { content, type: 'synced', source: 'local', updated_at: new Date() },
              });
          }
        }
      } catch (e) {
        this.logger.warn(`Failed to parse subtitle ${fullPath}`, e instanceof Error ? e.stack : String(e));
      } finally {
        try { fs.unlinkSync(fullPath); } catch {}
      }
    }
  }

  private parseVttToLrc(vttContent: string): string {
    const timeRe = /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->/;
    const cues: { seconds: number; text: string }[] = [];

    const blocks = vttContent.replace(/\r\n/g, '\n').split(/\n\n+/);
    for (const block of blocks) {
      const blockLines = block.split('\n').filter((l) => l.trim().length > 0);
      if (!blockLines.length) continue;
      if (/^(WEBVTT|NOTE|STYLE|Kind:|Language:)/.test(blockLines[0])) continue;

      const timeLineIdx = blockLines.findIndex((l) => timeRe.test(l));
      if (timeLineIdx === -1) continue;

      const match = blockLines[timeLineIdx].match(timeRe);
      if (!match) continue;
      const seconds =
        parseInt(match[1], 10) * 3600 +
        parseInt(match[2], 10) * 60 +
        parseInt(match[3], 10) +
        parseInt(match[4], 10) / 1000;

      const text = blockLines
        .slice(timeLineIdx + 1)
        .join(' ')
        .replace(/<[^>]*>/g, '')
        .trim();

      if (text) cues.push({ seconds, text });
    }

    return cues
      .map(({ seconds, text }) => {
        const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
        const ss = (seconds % 60).toFixed(2).padStart(5, '0');
        return `[${mm}:${ss}]${text}`;
      })
      .join('\n');
  }

  /**
   * Files in one directory sharing a filename stem (`song.mp3` + `song.mp4`) are
   * two sources of one track. Matched with a `LIKE` prefix on the indexed
   * `locator` column and then verified exactly in JS — `_` in a filename is a
   * single-character LIKE wildcard, so the pattern can over-match, never
   * under-match. (Loading every source row to scan in memory, as this used to,
   * made a scan quadratic in library size.)
   */
  private async findSiblingTrackId(filePath: string): Promise<string | null> {
    const dir = path.dirname(filePath);
    const stem = pairingStem(path.basename(filePath, path.extname(filePath)));

    // The pattern is anchored on the *normalized* stem, which for an upload is
    // not a prefix of the stored name, so the leading wildcard is unavoidable
    // here. It still narrows the set enough for the exact check below, which is
    // what actually decides.
    const candidates = await this.db
      .select({ track_id: schema.sources.track_id, locator: schema.sources.locator })
      .from(schema.sources)
      .where(and(eq(schema.sources.available, true), like(schema.sources.locator, `${dir}/%${stem}.%`)));

    for (const candidate of candidates) {
      if (candidate.locator === filePath) continue;
      if (
        path.dirname(candidate.locator) === dir &&
        pairingStem(path.basename(candidate.locator, path.extname(candidate.locator))) === stem
      ) {
        return candidate.track_id;
      }
    }
    return null;
  }

  private async markMissingUnavailable(rootPath: string): Promise<void> {
    const sources = await this.db
      .select({ id: schema.sources.id, locator: schema.sources.locator })
      .from(schema.sources)
      .where(and(eq(schema.sources.available, true), eq(schema.sources.origin, 'local')));

    const missing = sources.filter((s) => s.locator.startsWith(rootPath) && !fs.existsSync(s.locator));

    if (missing.length === 0) return;

    await this.db
      .update(schema.sources)
      .set({ available: false, deleted_at: new Date(), updated_at: new Date() })
      .where(inArray(schema.sources.id, missing.map((s) => s.id)));
  }

  private walkDir(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.walkDir(fullPath));
        } else if (entry.isFile()) {
          if (SUPPORTED_EXTS.has(path.extname(entry.name).toLowerCase())) results.push(fullPath);
        }
      }
    } catch (e) {
      this.logger.warn(`Cannot read directory ${dir}: ${e}`);
    }
    return results;
  }

  /**
   * Hashes only the leading 64KB — enough to fingerprint a file for change
   * detection without reading gigabytes of audio on every scan. Returns `''` on
   * any read error, which callers treat as "unknown, re-probe it".
   */
  private hashFile(filePath: string): string {
    try {
      const fd = fs.openSync(filePath, 'r');
      try {
        const buf = Buffer.alloc(65536);
        const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
        return crypto.createHash('sha256').update(buf.subarray(0, bytesRead)).digest('hex');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return '';
    }
  }

  getActiveScanJobId(): string | null {
    return this.activeScanJobId;
  }
}
