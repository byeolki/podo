import { Injectable, Logger, BadRequestException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { ScannerService } from '../library/scanner.service';
import { EventsService } from '../sync/events.service';
import { newId } from '../common/id';
import { Provider, providerFor, looksLikePlaylist } from './providers';
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
   * and its track resolved. Used by playlist auto-sync to append what it just
   * pulled; errors are logged and don't fail the job.
   */
  onTrackImported?: (trackId: string, sourceUrl: string | undefined) => Promise<void>;
}

// Subtitle/thumbnail flags shared by both the audio and video argument sets:
// --write-subs (never --write-auto-subs) grabs only manually-uploaded subtitle
// tracks, which for official music uploads are frequently the real timed lyrics;
// auto-generated captions are ASR output and deliberately excluded. `--sub-langs
// all` is safe because manual tracks are a small bounded set.
const SIDECAR_ARGS = [
  '--write-thumbnail', '--convert-thumbnails', 'jpg',
  '--write-subs', '--sub-langs', 'all', '--sub-format', 'vtt',
];

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
    const formatArgs = opts.audioOnly ?? true
      ? ['-x', '--audio-format', 'best', '--audio-quality', '0']
      : ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'];

    const args = [
      ...formatArgs,
      ...SIDECAR_ARGS,
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
      completedCount++;
      job.completed_items = completedCount;
      this.events.emit('download.progress', {
        job_id: job.id,
        completed_items: job.completed_items,
        total_items: job.total_items,
      });
      imports.push(this.importFile(filePath, sourceUrl || undefined, opts));
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
  private async importFile(filePath: string, sourceUrl: string | undefined, opts: DownloadOptions): Promise<void> {
    try {
      await this.scanner.scanFile(filePath, 'ytdlp', sourceUrl);
      if (!opts.onTrackImported) return;

      const source = await this.db
        .select({ track_id: schema.sources.track_id })
        .from(schema.sources)
        .where(eq(schema.sources.locator, filePath))
        .get();
      if (source) await opts.onTrackImported(source.track_id, sourceUrl);
    } catch (e) {
      this.logger.warn(`Failed to import ${filePath}: ${(e as Error).message}`);
    }
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
