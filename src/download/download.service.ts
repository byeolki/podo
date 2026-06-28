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
  error?: string;
  track_id?: string;
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
      created_at: new Date(),
    };
    this.jobs.set(jobId, job);

    setImmediate(() => this.run(job, audioOnly));
    return job;
  }

  private async run(job: DownloadJob, audioOnly: boolean): Promise<void> {
    job.status = 'running';
    this.events.emit('download.started', { job_id: job.id, url: job.url });

    const outputTemplate = path.join(this.uploadDir, `ytdlp_%(title)s.%(ext)s`);

    const args = audioOnly
      ? ['-x', '--audio-format', 'best', '--audio-quality', '0', '-o', outputTemplate, '--print', 'after_move:filepath', job.url]
      : ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '-o', outputTemplate, '--print', 'after_move:filepath', job.url];

    let outputPath = '';
    let stderr = '';

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(this.ytdlpPath, args, { stdio: 'pipe' });

      proc.stdout.on('data', (chunk: Buffer) => {
        const line = chunk.toString().trim();
        if (line && fs.existsSync(line)) outputPath = line;
      });

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
        if (code === 0) resolve();
        else reject(new Error(stderr.slice(-500)));
      });

      proc.on('error', (e) => reject(new Error(`yt-dlp not found: ${e.message}. Install with: pip install yt-dlp`)));
    }).catch((e: Error) => {
      job.status = 'failed';
      job.error = e.message;
      this.logger.error(`Download failed for ${job.url}: ${e.message}`);
      this.events.emit('download.failed', { job_id: job.id, error: e.message });
      throw e;
    });

    if (outputPath) {
      await this.scanner.scanFile(outputPath, 'ytdlp');
    }

    job.status = 'done';
    job.progress = 100;
    this.events.emit('download.completed', { job_id: job.id, path: outputPath });
    this.logger.log(`Download done: ${outputPath}`);
  }
}
