import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { spawn } from 'child_process';

export interface ProbeResult {
  format: string;
  codec: string;
  bitrate: number | null;
  sample_rate: number | null;
  channels: number | null;
  duration: number | null;
  tags: Record<string, string>;
}

@Injectable()
export class FfprobeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FfprobeService.name);
  private available = true;

  async onApplicationBootstrap() {
    await new Promise<void>((resolve) => {
      const proc = spawn('ffprobe', ['-version']);
      proc.on('error', () => {
        this.available = false;
        this.logger.warn('ffprobe not found — library scanning and transcoding will be disabled');
        resolve();
      });
      proc.on('close', () => resolve());
    });
  }

  async probe(filePath: string): Promise<ProbeResult | null> {
    if (!this.available) return null;

    return new Promise((resolve) => {
      const proc = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath,
      ]);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          this.logger.warn(`ffprobe failed for ${filePath}: ${stderr.slice(0, 200)}`);
          resolve(null);
          return;
        }

        try {
          const data = JSON.parse(stdout) as {
            format?: { format_name?: string; bit_rate?: string; duration?: string; tags?: Record<string, string> };
            streams?: Array<{ codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number; bit_rate?: string }>;
          };
          const fmt = data.format ?? {};
          const streams = data.streams ?? [];
          const audioStream = streams.find((s) => s.codec_type === 'audio');
          const videoStream = streams.find((s) => s.codec_type === 'video');
          const primaryStream = audioStream ?? videoStream;

          resolve({
            format: fmt.format_name?.split(',')[0] ?? '',
            codec: primaryStream?.codec_name ?? '',
            bitrate: fmt.bit_rate ? Math.round(parseInt(fmt.bit_rate, 10) / 1000) : null,
            sample_rate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate, 10) : null,
            channels: audioStream?.channels ?? null,
            duration: fmt.duration ? Math.round(parseFloat(fmt.duration) * 1000) : null,
            tags: fmt.tags ?? {},
          });
        } catch (e) {
          this.logger.warn(`ffprobe parse error for ${filePath}: ${e}`);
          resolve(null);
        }
      });

      proc.on('error', (err) => {
        this.available = false;
        this.logger.error(`ffprobe spawn error: ${err.message}`);
        resolve(null);
      });
    });
  }
}
