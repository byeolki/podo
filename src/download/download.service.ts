import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScannerService } from '../library/scanner.service';
import { EventsService } from '../sync/events.service';
import { newId } from '../common/id';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

export type DownloadStatus = 'pending' | 'running' | 'done' | 'failed';

export interface DownloadJob {
  id: string;
  url: string;
  status: DownloadStatus;
  progress: number;
  completed_items: number;
  total_items?: number;
  error?: string;
  created_at: Date;
}

@Injectable()
export class DownloadService {
  private readonly logger = new Logger(DownloadService.name);
  private readonly uploadDir: string;
  private readonly ytdlpPath: string;
  private readonly jobs = new Map<string, DownloadJob>();

  constructor(
    private readonly config: ConfigService,
    private readonly scanner: ScannerService,
    private readonly events: EventsService,
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

  async start(url: string, audioOnly = true): Promise<DownloadJob> {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new BadRequestException('Invalid URL');
    }

    const jobId = newId();
    const job: DownloadJob = {
      id: jobId,
      url,
      status: 'pending',
      progress: 0,
      completed_items: 0,
      created_at: new Date(),
    };
    this.jobs.set(jobId, job);

    setImmediate(() => {
      this.run(job, audioOnly).catch((e: Error) => {
        this.logger.error(`Unhandled error running download job ${job.id}: ${e.message}`, e.stack);
      });
    });
    return job;
  }

  private async run(job: DownloadJob, audioOnly: boolean): Promise<void> {
    job.status = 'running';
    this.events.emit('download.started', { job_id: job.id, url: job.url });

    job.total_items = await this.probeEntryCount(job.url);

    const outputTemplate = path.join(this.uploadDir, `ytdlp_%(title)s.%(ext)s`);

    const args = audioOnly
      ? ['-x', '--audio-format', 'best', '--audio-quality', '0', '--write-thumbnail', '--convert-thumbnails', 'jpg', '-o', outputTemplate, '--print', 'after_move:filepath', job.url]
      : ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--write-thumbnail', '--convert-thumbnails', 'jpg', '-o', outputTemplate, '--print', 'after_move:filepath', job.url];

    let completedCount = 0;
    let stdoutBuffer = '';
    let stderr = '';

    const captureLine = (raw: string) => {
      const line = raw.trim();
      if (!line || !fs.existsSync(line)) return;
      completedCount++;
      job.completed_items = completedCount;
      this.events.emit('download.progress', { job_id: job.id, completed_items: job.completed_items, total_items: job.total_items });
      void this.scanner.scanFile(line, 'ytdlp');
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
            this.events.emit('download.progress', { job_id: job.id, progress: job.progress, completed_items: job.completed_items, total_items: job.total_items });
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
      job.status = 'failed';
      job.error = err.message;
      this.logger.error(`Download failed for ${job.url}: ${err.message}`);
      this.events.emit('download.failed', { job_id: job.id, error: err.message });
      return;
    }

    job.status = 'done';
    job.progress = 100;
    this.events.emit('download.completed', { job_id: job.id, count: completedCount });
    this.logger.log(`Download done: ${completedCount} file(s) for ${job.url}`);
  }

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
