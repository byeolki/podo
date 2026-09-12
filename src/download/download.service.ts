import { Injectable, Logger, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { ScannerService } from '../library/scanner.service';
import { EventsService } from '../sync/events.service';
import { newId } from '../common/id';
import { Provider, providerFor, looksLikePlaylist, PROVIDER_LABELS } from './providers';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

export type DownloadStatus = 'pending' | 'running' | 'done' | 'failed';

export interface DownloadJob {
  id: string;
  url: string;
  provider: Provider;
  status: DownloadStatus;
  progress: number;
  completed_items: number;
  total_items?: number;
  error?: string;
  created_at: Date;
  /** Set when the job is re-fetching an existing track rather than adding one. */
  refresh_track_id?: string;
}

/** What `GET /download/source/:trackId` reports about a track's remote origin. */
export interface TrackSourceInfo {
  track_id: string;
  source_id: string;
  source_url: string | null;
  provider: Provider | null;
  provider_label: string | null;
  media_kind: 'audio' | 'video';
  /** False when there is nothing to re-fetch from. */
  refreshable: boolean;
  last_refreshed_at: Date;
}

export interface DownloadOptions {
  audioOnly?: boolean;
  /**
   * Follow a playlist URL instead of downloading just the item it names.
   * Defaults to auto-detection (`looksLikePlaylist`).
   */
  allowPlaylist?: boolean;
  /**
   * Called once per downloaded file, after it has been scanned into the library
   * and its track resolved. Errors are logged and don't fail the job.
   *
   * `index` is the item's position in the source playlist, counted from the
   * order yt-dlp prints them in. Imports run concurrently and therefore finish
   * out of order, so a caller that cares about sequence has to place by this
   * rather than by arrival.
   */
  onTrackImported?: (trackId: string, sourceUrl: string | undefined, index: number) => Promise<void>;
}

/**
 * Thumbnail and subtitles are fetched in their own passes, after the media is
 * already on disk — never as extra flags on the download itself.
 *
 * They used to ride along on the main invocation, and that made them able to
 * lose the download: yt-dlp exits non-zero if a sidecar fails, so a single
 * `HTTP Error 429: Too Many Requests` on one subtitle track failed the whole job
 * and the audio was thrown away with it. Sidecars are enrichment; the media is
 * the point. Each pass is separately best-effort so neither can take out the
 * other, and both are `--skip-download`, so a retry costs a metadata request
 * rather than the file again.
 *
 * `--write-subs` (never `--write-auto-subs`) grabs only manually-uploaded
 * subtitle tracks, which for official music uploads are frequently the real timed
 * lyrics; auto-generated captions are ASR output and deliberately excluded.
 * `--sub-langs all` is safe because manual tracks are a small bounded set.
 */
const SIDECAR_PASSES: { label: string; args: string[] }[] = [
  { label: 'thumbnail', args: ['--write-thumbnail', '--convert-thumbnails', 'jpg'] },
  {
    label: 'subtitles',
    // `--sleep-subtitles` paces the per-language requests. Asking for every manual
    // track fires one request per language back to back, and YouTube answers the
    // burst with `HTTP Error 429: Too Many Requests` — the rate limit was largely
    // self-inflicted.
    args: ['--write-subs', '--sub-langs', 'all', '--sub-format', 'vtt', '--sleep-subtitles', '1'],
  },
];

const SIDECAR_TIMEOUT_MS = 120_000;
/** Retries only for rate limiting; a video with no subtitles is not retried. */
const SIDECAR_RETRIES = 3;
const SIDECAR_RETRY_BASE_MS = 5_000;

@Injectable()
export class DownloadService {
  private readonly logger = new Logger(DownloadService.name);
  private readonly uploadDir: string;
  private readonly ytdlpPath: string;
  private readonly jobs = new Map<string, DownloadJob>();
  /// Kept only so `runToCompletion` can await a job it queued; entries are
  /// dropped as soon as the run settles.
  private readonly activeRuns = new Map<string, Promise<void>>();

  constructor(
    private readonly config: ConfigService,
    private readonly scanner: ScannerService,
    private readonly events: EventsService,
    @Inject(DB_TOKEN) private readonly db: Db,
  ) {
    this.uploadDir = config.get<string>('upload_dir', path.join(process.cwd(), 'data', 'uploads'));
    this.ytdlpPath = config.get<string>('ytdlp_path', 'yt-dlp');
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  listJobs(): DownloadJob[] {
    return [...this.jobs.values()].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  getJob(id: string): DownloadJob | undefined {
    return this.jobs.get(id);
  }

  /**
   * Queues a yt-dlp download. Any site yt-dlp supports works — YouTube, X,
   * SoundCloud, Bandcamp and the rest — so the URL is only checked for a usable
   * scheme, not against a provider allowlist.
   */
  async start(url: string, audioOnly = true, opts: DownloadOptions = {}): Promise<DownloadJob> {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new BadRequestException('Invalid URL');
    }

    const jobId = newId();
    const job: DownloadJob = {
      id: jobId,
      url,
      provider: providerFor(url),
      status: 'pending',
      progress: 0,
      completed_items: 0,
      created_at: new Date(),
    };
    this.jobs.set(jobId, job);

    const run = new Promise<void>((resolve) => {
      setImmediate(() => {
        this.run(job, { audioOnly, ...opts })
          .catch((e: Error) => {
            this.logger.error(`Unhandled error running download job ${job.id}: ${e.message}`, e.stack);
          })
          .finally(() => {
            this.activeRuns.delete(job.id);
            resolve();
          });
      });
    });
    this.activeRuns.set(job.id, run);
    return job;
  }

  /**
   * Queues a download and waits for it to settle. Playlist auto-sync uses this
   * rather than `start`, since it has to know what actually landed (via
   * `onTrackImported`) before it can report a result.
   */
  async runToCompletion(url: string, opts: DownloadOptions = {}): Promise<DownloadJob> {
    const job = await this.start(url, opts.audioOnly ?? true, opts);
    await this.activeRuns.get(job.id);
    return job;
  }

  private async run(job: DownloadJob, opts: DownloadOptions): Promise<void> {
    job.status = 'running';
    this.events.emit('download.started', { job_id: job.id, url: job.url, provider: job.provider });

    const followPlaylist = opts.allowPlaylist ?? looksLikePlaylist(job.url);
    if (followPlaylist) {
      job.total_items = await this.probeEntryCount(job.url);
    }

    const outputTemplate = path.join(this.uploadDir, 'ytdlp_%(title)s.%(ext)s');

    // Tab-separated so we can record which URL each downloaded file came from
    // (webpage_url is the canonical per-item URL — the individual video, even
    // when the job pointed at a whole playlist).
    const printTemplate = 'after_move:%(filepath)s\t%(webpage_url)s';
    const formatArgs = [...this.formatArgs(opts.audioOnly ?? true), '--embed-metadata'];

    const args = [
      ...formatArgs,
      followPlaylist ? '--yes-playlist' : '--no-playlist',
      '-o', outputTemplate,
      '--print', printTemplate,
      job.url,
    ];

    let completedCount = 0;
    let stdoutBuffer = '';
    let stderr = '';
    const imports: Promise<void>[] = [];

    const captureLine = (raw: string) => {
      const line = raw.trim();
      if (!line) return;
      const [filePath, sourceUrl] = line.split('\t');
      if (!filePath || !fs.existsSync(filePath)) return;
      const index = completedCount;
      completedCount++;
      job.completed_items = completedCount;
      this.events.emit('download.progress', {
        job_id: job.id,
        completed_items: job.completed_items,
        total_items: job.total_items,
      });
      imports.push(this.importFile(filePath, sourceUrl || undefined, opts, index));
    };

    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(this.ytdlpPath, args, { stdio: 'pipe' });

        proc.stdout.on('data', (chunk: Buffer) => {
          stdoutBuffer += chunk.toString();
          const lines = stdoutBuffer.split('\n');
          stdoutBuffer = lines.pop() ?? '';
          for (const line of lines) captureLine(line);
        });

        proc.stderr.on('data', (chunk: Buffer) => {
          const line = chunk.toString();
          stderr += line;
          const match = line.match(/(\d+\.\d+)%/);
          if (match) {
            job.progress = parseFloat(match[1]);
            this.events.emit('download.progress', {
              job_id: job.id,
              progress: job.progress,
              completed_items: job.completed_items,
              total_items: job.total_items,
            });
          }
        });

        proc.on('close', (code) => {
          captureLine(stdoutBuffer);
          if (code === 0) resolve();
          else reject(new Error(stderr.slice(-500)));
        });

        proc.on('error', (e) => reject(new Error(`yt-dlp not found: ${e.message}. Install with: pip install yt-dlp`)));
      });
    } catch (e: unknown) {
      const err = e as Error;
      // Files that already made it in are still worth importing before failing.
      await Promise.allSettled(imports);
      job.status = 'failed';
      job.error = err.message;
      this.logger.error(`Download failed for ${job.url}: ${err.message}`);
      this.events.emit('download.failed', { job_id: job.id, error: err.message });
      return;
    }

    await Promise.allSettled(imports);

    job.status = 'done';
    job.progress = 100;
    this.events.emit('download.completed', { job_id: job.id, count: completedCount });
    this.logger.log(`Download done: ${completedCount} file(s) from ${job.provider} for ${job.url}`);
  }

  /**
   * Scans one downloaded file into the library, then resolves the track it
   * became so callers can act on it. The scanner keys sources by absolute path,
   * so the file's own locator is the correlation key.
   */
  private async importFile(
    filePath: string,
    sourceUrl: string | undefined,
    opts: DownloadOptions,
    index: number,
  ): Promise<void> {
    try {
      // Ahead of the scan: the scanner picks the thumbnail and subtitles up as
      // sidecar files sitting next to the media, so they have to be there first.
      if (sourceUrl) await this.fetchSidecars(filePath, sourceUrl);
      await this.scanner.scanFile(filePath, 'ytdlp', sourceUrl);
      if (!opts.onTrackImported) return;

      const source = await this.db
        .select({ track_id: schema.sources.track_id })
        .from(schema.sources)
        .where(eq(schema.sources.locator, filePath))
        .get();
      if (source) await opts.onTrackImported(source.track_id, sourceUrl, index);
    } catch (e) {
      this.logger.warn(`Failed to import ${filePath}: ${(e as Error).message}`);
    }
  }

  /**
   * What we know about where a track came from, so a client can decide whether to
   * offer a refresh and what to label it.
   */
  async getTrackSource(trackId: string): Promise<TrackSourceInfo> {
    const source = await this.pickRefreshableSource(trackId);
    if (!source) throw new NotFoundException('Track has no source');

    const url = source.source_url;
    return {
      track_id: trackId,
      source_id: source.id,
      source_url: url,
      provider: url ? providerFor(url) : null,
      provider_label: url ? PROVIDER_LABELS[providerFor(url)] : null,
      media_kind: source.media_kind,
      refreshable: source.origin === 'ytdlp' && !!url,
      last_refreshed_at: source.updated_at,
    };
  }

  /**
   * Re-downloads a track from the URL it was originally pulled from, so an
   * upstream re-upload — a fixed mix, a restored video, subtitles added after the
   * fact — lands on the existing track instead of arriving as a duplicate.
   *
   * The identity that must survive is the track row: playlists, favorites and play
   * counts all hang off it. So the new file takes over the old source row rather
   * than being scanned in as a new one, and the scan is forced (see
   * `ScannerService.scanFile`) because an unchanged media file can still carry a
   * new thumbnail or newly-added subtitles.
   */
  async refreshTrack(trackId: string): Promise<DownloadJob> {
    const source = await this.pickRefreshableSource(trackId);
    if (!source) throw new NotFoundException('Track has no source');
    if (source.origin !== 'ytdlp' || !source.source_url) {
      throw new BadRequestException('This track was not downloaded from a URL, so there is nothing to re-fetch');
    }

    const url = source.source_url;
    const job: DownloadJob = {
      id: newId(),
      url,
      provider: providerFor(url),
      status: 'pending',
      progress: 0,
      completed_items: 0,
      created_at: new Date(),
      refresh_track_id: trackId,
    };
    this.jobs.set(job.id, job);

    const run = new Promise<void>((resolve) => {
      setImmediate(() => {
        this.runRefresh(job, { id: source.id, locator: source.locator, mediaKind: source.media_kind, url })
          .catch((e: Error) => {
            this.logger.error(`Unhandled error refreshing track ${trackId}: ${e.message}`, e.stack);
          })
          .finally(() => {
            this.activeRuns.delete(job.id);
            resolve();
          });
      });
    });
    this.activeRuns.set(job.id, run);
    return job;
  }

  /** Queues a refresh and waits for it to settle. */
  async refreshTrackToCompletion(trackId: string): Promise<DownloadJob> {
    const job = await this.refreshTrack(trackId);
    await this.activeRuns.get(job.id);
    return job;
  }

  /**
   * The source a refresh should act on: the highest-priority yt-dlp source that
   * still remembers its URL, falling back to any source at all so
   * `getTrackSource` can explain *why* a track isn't refreshable.
   */
  private async pickRefreshableSource(trackId: string) {
    const withUrl = await this.db
      .select()
      .from(schema.sources)
      .where(and(
        eq(schema.sources.track_id, trackId),
        eq(schema.sources.origin, 'ytdlp'),
        isNotNull(schema.sources.source_url),
      ))
      .orderBy(desc(schema.sources.priority), desc(schema.sources.updated_at))
      .get();
    if (withUrl) return withUrl;

    return this.db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.track_id, trackId))
      .orderBy(desc(schema.sources.priority))
      .get();
  }

  private async runRefresh(
    job: DownloadJob,
    source: { id: string; locator: string; mediaKind: 'audio' | 'video'; url: string },
  ): Promise<void> {
    job.status = 'running';
    this.events.emit('download.started', {
      job_id: job.id,
      url: job.url,
      provider: job.provider,
      refresh_track_id: job.refresh_track_id,
    });

    // Downloaded aside first: a failed or partial re-fetch must not be able to
    // destroy the copy that currently plays.
    const stagingDir = fs.mkdtempSync(path.join(this.uploadDir, '.refresh-'));

    try {
      const downloaded = await this.runYtdlp(job, [
        ...this.formatArgs(source.mediaKind !== 'video'),
        '--embed-metadata',
        '--no-playlist',
        '-o', path.join(stagingDir, 'media.%(ext)s'),
        '--print', 'after_move:%(filepath)s',
        source.url,
      ]);

      if (!downloaded || !fs.existsSync(downloaded)) {
        throw new Error('yt-dlp produced no media file');
      }

      await this.fetchSidecars(downloaded, source.url);
      const finalPath = this.replaceMediaFile(source.locator, downloaded, stagingDir);

      // The scanner keys everything off the locator, so the row has to point at
      // the new file before the scan runs — otherwise the scan sees an unknown
      // path and creates a second track for the same song.
      if (finalPath !== source.locator) {
        await this.db
          .update(schema.sources)
          .set({ locator: finalPath, updated_at: new Date() })
          .where(eq(schema.sources.id, source.id));
      }

      await this.scanner.scanFile(finalPath, 'ytdlp', source.url, { force: true });

      job.status = 'done';
      job.progress = 100;
      job.completed_items = 1;
      this.events.emit('download.completed', {
        job_id: job.id,
        count: 1,
        refresh_track_id: job.refresh_track_id,
      });
      this.logger.log(`Refreshed track ${job.refresh_track_id} from ${source.url}`);
    } catch (e: unknown) {
      const err = e as Error;
      job.status = 'failed';
      job.error = err.message;
      this.logger.error(`Refresh failed for ${source.url}: ${err.message}`);
      this.events.emit('download.failed', {
        job_id: job.id,
        error: err.message,
        refresh_track_id: job.refresh_track_id,
      });
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  /**
   * Moves the freshly downloaded media (and the thumbnail/subtitle sidecars that
   * came with it) onto the old file's name, and reports where it landed.
   *
   * The extension can legitimately change between downloads — yt-dlp picks the
   * best available format each time — so the stem is preserved and the extension
   * is taken from the new file. Sidecars are renamed to match, since the scanner
   * finds them by the media file's stem.
   */
  private replaceMediaFile(oldLocator: string, downloaded: string, stagingDir: string): string {
    const dir = path.dirname(oldLocator);
    const stem = path.basename(oldLocator, path.extname(oldLocator));
    const finalPath = path.join(dir, stem + path.extname(downloaded));

    if (fs.existsSync(oldLocator) && oldLocator !== finalPath) {
      fs.rmSync(oldLocator, { force: true });
    }
    fs.rmSync(finalPath, { force: true });
    fs.renameSync(downloaded, finalPath);

    const downloadedStem = path.basename(downloaded, path.extname(downloaded));
    for (const entry of fs.readdirSync(stagingDir)) {
      if (!entry.startsWith(`${downloadedStem}.`)) continue;
      const suffix = entry.slice(downloadedStem.length);
      try {
        fs.renameSync(path.join(stagingDir, entry), path.join(dir, stem + suffix));
      } catch (e) {
        this.logger.warn(`Failed to move sidecar ${entry}: ${(e as Error).message}`);
      }
    }

    return finalPath;
  }

  /**
   * Runs yt-dlp for a single item, reporting percentage progress on the job, and
   * resolves with the path it printed. Rejects with yt-dlp's own stderr tail,
   * which is what makes a failure actionable (private video, geo block, 404).
   */
  private runYtdlp(job: DownloadJob, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      const proc = spawn(this.ytdlpPath, args, { stdio: 'pipe' });

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });

      proc.stderr.on('data', (chunk: Buffer) => {
        const line = chunk.toString();
        stderr += line;
        const match = line.match(/(\d+\.\d+)%/);
        if (match) {
          job.progress = parseFloat(match[1]);
          this.events.emit('download.progress', { job_id: job.id, progress: job.progress });
        }
      });

      proc.on('close', (code) => {
        if (code === 0) resolve(stdout.trim().split('\n').filter(Boolean).pop() ?? '');
        else reject(new Error(stderr.slice(-500) || `yt-dlp exited with code ${code}`));
      });
      proc.on('error', (e) => reject(new Error(`yt-dlp not found: ${e.message}. Install with: pip install yt-dlp`)));
    });
  }

  /**
   * `--embed-metadata` writes the uploader and title into the file's own tags.
   * Without it a yt-dlp import carries no tags at all, and the scanner falls back
   * to the output filename — which is how tracks ended up titled
   * `ytdlp_<video title>` with no artist.
   */
  private formatArgs(audioOnly: boolean): string[] {
    return audioOnly
      ? ['-x', '--audio-format', 'best', '--audio-quality', '0']
      : ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'];
  }

  /**
   * Pulls the thumbnail and subtitles for an already-downloaded file, naming them
   * after it so the scanner finds them. Every failure is logged and swallowed —
   * see `SIDECAR_PASSES` for why these can never be allowed to fail a download.
   */
  private async fetchSidecars(mediaPath: string, url: string): Promise<void> {
    const stem = path.join(
      path.dirname(mediaPath),
      path.basename(mediaPath, path.extname(mediaPath)),
    );

    for (const pass of SIDECAR_PASSES) {
      const args = [
        '--skip-download', '--no-playlist', '--no-warnings',
        ...pass.args,
        '-o', `${stem}.%(ext)s`,
        url,
      ];

      let error: string | null = null;
      for (let attempt = 0; attempt <= SIDECAR_RETRIES; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, SIDECAR_RETRY_BASE_MS * attempt));
          this.logger.debug(`Retrying ${pass.label} for ${url} (attempt ${attempt + 1})`);
        }
        error = await this.runSidecarPass(args);
        if (!error || !/429|too many requests/i.test(error)) break;
      }

      if (error) {
        this.logger.debug(`No ${pass.label} for ${url}: ${error}`);
      }
    }
  }

  /** Resolves with an error description, or null when the pass succeeded. */
  private runSidecarPass(args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      let stderr = '';
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const proc = spawn(this.ytdlpPath, args, { stdio: 'pipe' });
      proc.stdout.on('data', () => {});
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        finish('timed out');
      }, SIDECAR_TIMEOUT_MS);
      timer.unref();

      proc.on('close', (code) => {
        clearTimeout(timer);
        finish(code === 0 ? null : stderr.trim().split('\n').pop() ?? `exit ${code}`);
      });
      proc.on('error', (e) => {
        clearTimeout(timer);
        finish(e.message);
      });
    });
  }

  /** Best-effort item count for a playlist URL, used only for progress display. */
  private probeEntryCount(url: string): Promise<number | undefined> {
    return new Promise((resolve) => {
      let output = '';
      let resolved = false;
      const proc = spawn(this.ytdlpPath, ['--flat-playlist', '--print', '%(n_entries)s', url]);

      const finish = (value: number | undefined) => {
        if (resolved) return;
        resolved = true;
        proc.kill('SIGKILL');
        resolve(value);
      };

      proc.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        const firstLine = output.split('\n')[0]?.trim();
        if (firstLine) {
          const n = parseInt(firstLine, 10);
          finish(Number.isFinite(n) && n > 1 ? n : undefined);
        }
      });
      proc.on('close', () => finish(undefined));
      proc.on('error', () => finish(undefined));

      setTimeout(() => finish(undefined), 8000);
    });
  }
}
