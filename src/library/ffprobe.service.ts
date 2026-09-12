import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { spawn } from 'child_process';

export interface ProbeResult {
  format: string;
  codec: string;
  bitrate: number | null;
  sample_rate: number | null;
  channels: number | null;
  duration: number | null;
  replaygain_track: number | null;
  replaygain_album: number | null;
  /** True when the file embeds cover art (an `attached_pic` video stream). */
  has_embedded_art: boolean;
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
            streams?: Array<{
              codec_type?: string; codec_name?: string; sample_rate?: string;
              channels?: number; bit_rate?: string;
              disposition?: { attached_pic?: number };
              tags?: Record<string, string>;
            }>;
          };
          const fmt = data.format ?? {};
          const streams = data.streams ?? [];
          const audioStream = streams.find((s) => s.codec_type === 'audio');
          const videoStream = streams.find((s) => s.codec_type === 'video');
          const primaryStream = audioStream ?? videoStream;

          // Ogg-family containers (Opus, Vorbis, FLAC) carry their Vorbis comments
          // on the audio stream, not on the container — reading only `format.tags`
          // left every one of those files apparently untagged, so the scanner fell
          // back to the filename for a title and had no artist at all. Container
          // tags still win where both exist (MP3/MP4/Matroska).
          const tags = { ...(audioStream?.tags ?? {}), ...(fmt.tags ?? {}) };
          const rgTag = (k: string) => tags[k] ?? tags[k.toLowerCase()] ?? null;
          const parseRg = (v: string | null) => {
            if (!v) return null;
            const n = parseFloat(v.replace(/[^0-9.+-]/g, ''));
            return isNaN(n) ? null : n;
          };

          resolve({
            format: fmt.format_name?.split(',')[0] ?? '',
            codec: primaryStream?.codec_name ?? '',
            bitrate: fmt.bit_rate ? Math.round(parseInt(fmt.bit_rate, 10) / 1000) : null,
            sample_rate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate, 10) : null,
            channels: audioStream?.channels ?? null,
            duration: fmt.duration ? Math.round(parseFloat(fmt.duration) * 1000) : null,
            replaygain_track: parseRg(rgTag('REPLAYGAIN_TRACK_GAIN')),
            replaygain_album: parseRg(rgTag('REPLAYGAIN_ALBUM_GAIN')),
            // Cover art rides along as a video stream flagged `attached_pic`;
            // that flag is what separates it from an actual music video.
            has_embedded_art: streams.some((st) => st.disposition?.attached_pic === 1),
            tags,
          });
        } catch (e) {
          this.logger.warn(`ffprobe parse error for ${filePath}: ${e}`);
          resolve(null);
        }
      });

      proc.on('error', (err) => {
        // Only a missing binary is permanent. A transient spawn failure — EMFILE
        // or EAGAIN during a burst — used to latch this off for the rest of the
        // process, after which every scan silently imported nothing.
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          this.available = false;
          this.logger.error(`ffprobe not found: ${err.message}`);
        } else {
          this.logger.warn(`ffprobe spawn failed for ${filePath}: ${err.message}`);
        }
        resolve(null);
      });
    });
  }
}
