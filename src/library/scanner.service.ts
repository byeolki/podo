import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
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
import PQueue from 'p-queue';

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.flac', '.aac', '.wav', '.ogg', '.opus']);
const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.mkv']);
const SUPPORTED_EXTS = new Set([...AUDIO_EXTS, ...VIDEO_EXTS]);

function mediaKind(ext: string): 'audio' | 'video' | null {
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);
  private readonly scanQueue = new PQueue({ concurrency: 4 });
  private activeScanJobId: string | null = null;

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly ffprobe: FfprobeService,
    private readonly metadata: MetadataService,
    private readonly events: EventsService,
    @Optional() private readonly ai: AiService | null,
  ) {}

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

  async scanFile(filePath: string, origin: 'local' | 'ytdlp' = 'local'): Promise<void> {
    const ext = path.extname(filePath).toLowerCase();
    const kind = mediaKind(ext);
    if (!kind) return;

    await this.scanQueue.add(() => this.upsertSource(filePath, kind, origin));
  }

  async removeFile(filePath: string): Promise<void> {
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
  }

  private async runScan(jobId: string, libraryRootId: string, rootPath: string): Promise<void> {
    try {
      const files = this.walkDir(rootPath);
      const total = files.length;

      await this.db
        .update(schema.scan_jobs)
        .set({ total_files: total })
        .where(eq(schema.scan_jobs.id, jobId));

      let processed = 0;
      let added = 0;
      let updated = 0;

      for (const filePath of files) {
        const ext = path.extname(filePath).toLowerCase();
        const kind = mediaKind(ext);
        if (!kind) { processed++; continue; }

        try {
          const result = await this.scanQueue.add(() => this.upsertSource(filePath, kind));
          if (result === 'added') added++;
          else if (result === 'updated') updated++;
        } catch (e) {
          this.logger.warn(`Failed to scan ${filePath}`, e instanceof Error ? e.stack : String(e));
        }

        processed++;
        if (processed % 50 === 0) {
          await this.db
            .update(schema.scan_jobs)
            .set({ processed_files: processed, added, updated })
            .where(eq(schema.scan_jobs.id, jobId));

          this.events.emit('scan.progress', { job_id: jobId, total, processed, added, updated });
        }
      }

      await this.markMissingUnavailable(rootPath);

      await this.db.update(schema.scan_jobs).set({
        status: 'completed',
        processed_files: processed,
        added,
        updated,
        finished_at: new Date(),
      }).where(eq(schema.scan_jobs.id, jobId));

      await this.db
        .update(schema.library_roots)
        .set({ last_scan_at: new Date() })
        .where(eq(schema.library_roots.id, libraryRootId));

      this.events.emit('scan.completed', { job_id: jobId, total, added, updated });
    } catch (e) {
      await this.db.update(schema.scan_jobs).set({
        status: 'failed',
        error: String(e),
        finished_at: new Date(),
      }).where(eq(schema.scan_jobs.id, jobId));

      this.events.emit('scan.failed', { job_id: jobId, error: String(e) });
    } finally {
      this.activeScanJobId = null;
    }
  }

  private async upsertSource(filePath: string, kind: 'audio' | 'video', origin: 'local' | 'ytdlp' = 'local'): Promise<'added' | 'updated' | 'skipped'> {
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

    if (existing) {
      const mtime = stat.mtimeMs;
      const existingMtime = existing.updated_at?.getTime() ?? 0;
      if (Math.abs(mtime - existingMtime) < 2000) return 'skipped';
    }

    const probe = await this.ffprobe.probe(filePath);
    if (!probe) return 'skipped';

    const meta = this.metadata.parseTags(probe);

    let isCover = false;
    let originalArtistId: string | null = null;

    if (this.ai?.enabled && (!meta.title || !meta.artist)) {
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
        if (aiResult.is_cover && aiResult.original_artist) {
          originalArtistId = await this.metadata.resolveOrCreateArtist(aiResult.original_artist);
        }
      }
    }

    const title = meta.title ?? path.basename(filePath, path.extname(filePath));
    const fileHash = this.hashFile(filePath);

    const artistId = meta.artist ? await this.metadata.resolveOrCreateArtist(meta.artist) : null;
    const albumArtistId = meta.album_artist
      ? await this.metadata.resolveOrCreateArtist(meta.album_artist)
      : artistId;

    let albumVersionId: string | null = null;
    if (meta.album) {
      albumVersionId = await this.metadata.resolveOrCreateAlbumVersion(
        meta.album,
        albumArtistId,
        meta.year,
      );
    }

    if (!existing) {
      const siblingTrackId = await this.findSiblingTrackId(filePath);
      if (siblingTrackId) {
        const sourceId = newId();
        await this.db.insert(schema.sources).values({
          id: sourceId,
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
        }).onConflictDoNothing();
        this.events.emit('track.upserted', { track_id: siblingTrackId });
        return 'added';
      }
    }

    if (existing) {
      const trackId = existing.track_id;

      await this.db.update(schema.tracks).set({
        title,
        album_version_id: albumVersionId ?? undefined,
        track_number: meta.track_number ?? undefined,
        disc_number: meta.disc_number ?? undefined,
        canonical_duration: probe.duration ?? undefined,
        is_cover: isCover,
        original_artist_id: originalArtistId ?? undefined,
        updated_at: new Date(),
      }).where(eq(schema.tracks.id, trackId));

      await this.db.update(schema.sources).set({
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
      }).where(eq(schema.sources.id, existing.id));

      if (artistId) {
        await this.db.delete(schema.track_artists).where(eq(schema.track_artists.track_id, trackId));
        await this.db.insert(schema.track_artists).values({ track_id: trackId, artist_id: artistId, position: 0 });
      }

      this.events.emit('track.upserted', { track_id: trackId });
      return 'updated';
    }

    const trackId = newId();
    await this.db.insert(schema.tracks).values({
      id: trackId,
      title,
      album_version_id: albumVersionId ?? undefined,
      track_number: meta.track_number ?? undefined,
      disc_number: meta.disc_number ?? undefined,
      canonical_duration: probe.duration ?? undefined,
      is_cover: isCover,
      original_artist_id: originalArtistId ?? undefined,
    });

    if (artistId) {
      await this.db.insert(schema.track_artists).values({ track_id: trackId, artist_id: artistId, position: 0 });
    }

    if (meta.genres.length) {
      const tagIds = await this.metadata.ensureGenres(meta.genres);
      for (const tagId of tagIds) {
        await this.db.insert(schema.track_tags).values({ track_id: trackId, tag_id: tagId }).onConflictDoNothing();
      }
    }

    const sourceId = newId();
    await this.db.insert(schema.sources).values({
      id: sourceId,
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
    });

    this.events.emit('track.upserted', { track_id: trackId });
    return 'added';
  }

  private async findSiblingTrackId(filePath: string): Promise<string | null> {
    const dir = path.dirname(filePath);
    const stem = path.basename(filePath, path.extname(filePath));
    const sources = await this.db
      .select({ track_id: schema.sources.track_id, locator: schema.sources.locator })
      .from(schema.sources)
      .where(eq(schema.sources.available, true));
    for (const s of sources) {
      if (s.locator === filePath) continue;
      if (path.dirname(s.locator) === dir && path.basename(s.locator, path.extname(s.locator)) === stem) {
        return s.track_id;
      }
    }
    return null;
  }

  private async markMissingUnavailable(rootPath: string): Promise<void> {
    const sources = await this.db
      .select({ id: schema.sources.id, locator: schema.sources.locator })
      .from(schema.sources)
      .where(and(eq(schema.sources.available, true), eq(schema.sources.origin, 'local')));

    const missing = sources.filter((s) => {
      return s.locator.startsWith(rootPath) && !fs.existsSync(s.locator);
    });

    if (missing.length === 0) return;

    const ids = missing.map((s) => s.id);
    await this.db
      .update(schema.sources)
      .set({ available: false, deleted_at: new Date(), updated_at: new Date() })
      .where(inArray(schema.sources.id, ids));
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
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTS.has(ext)) results.push(fullPath);
        }
      }
    } catch (e) {
      this.logger.warn(`Cannot read directory ${dir}: ${e}`);
    }
    return results;
  }

  private hashFile(filePath: string): string {
    try {
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(65536);
      fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      return crypto.createHash('sha256').update(buf).digest('hex');
    } catch {
      return '';
    }
  }

  getActiveScanJobId(): string | null {
    return this.activeScanJobId;
  }
}
