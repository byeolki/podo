import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';

export interface YoutubeSearchResult {
  id: string;
  title: string;
  duration: number | null;
  channel: string | null;
  thumbnail: string | null;
  url: string;
}

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);
  private readonly ytdlpPath: string;

  constructor(private readonly config: ConfigService) {
    this.ytdlpPath = config.get<string>('ytdlp_path', 'yt-dlp');
  }

  async search(query: string, limit = 10): Promise<YoutubeSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const safeLimit = Math.min(Math.max(limit, 1), 25);

    return new Promise((resolve) => {
      let stdout = '';
      const proc = spawn(this.ytdlpPath, ['--flat-playlist', '--dump-json', `ytsearch${safeLimit}:${trimmed}`]);

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', () => {});

      proc.on('close', () => resolve(this.parseResults(stdout)));
      proc.on('error', (e) => {
        this.logger.warn(`YouTube search failed: ${e.message}`);
        resolve([]);
      });
    });
  }

  private parseResults(stdout: string): YoutubeSearchResult[] {
    const results: YoutubeSearchResult[] = [];
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        const thumbnails = obj.thumbnails as Array<{ url: string }> | undefined;
        results.push({
          id: String(obj.id),
          title: String(obj.title ?? 'Untitled'),
          duration: typeof obj.duration === 'number' ? obj.duration : null,
          channel: (obj.channel as string) ?? (obj.uploader as string) ?? null,
          thumbnail: thumbnails?.[0]?.url ?? null,
          url: (obj.webpage_url as string) ?? `https://www.youtube.com/watch?v=${obj.id}`,
        });
      } catch {
        // skip malformed line
      }
    }
    return results;
  }
}
