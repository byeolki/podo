import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';

export interface MediaSearchResult {
  id: string;
  title: string;
  duration: number | null;
  channel: string | null;
  thumbnail: string | null;
  url: string;
}

/** One entry of a remote playlist, as reported by `yt-dlp --flat-playlist`. */
export interface RemotePlaylistEntry {
  id: string;
  title: string;
  url: string;
}

const SEARCH_TIMEOUT_MS = 20_000;
const PLAYLIST_TIMEOUT_MS = 60_000;

/**
 * Thin wrapper around the yt-dlp binary for the read-only operations: searching,
 * and listing what's in a remote playlist. Downloading lives in DownloadService.
 *
 * Search is YouTube-specific (`ytsearch:` is yt-dlp's only general-purpose search
 * backend); everything else here works against any site yt-dlp supports.
 */
@Injectable()
export class YtdlpService {
  private readonly logger = new Logger(YtdlpService.name);
  private readonly ytdlpPath: string;

  constructor(private readonly config: ConfigService) {
    this.ytdlpPath = config.get<string>('ytdlp_path', 'yt-dlp');
  }

  async searchYouTube(query: string, limit = 10): Promise<MediaSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const safeLimit = Math.min(Math.max(limit, 1), 25);

    const stdout = await this.run(
      ['--flat-playlist', '--dump-json', `ytsearch${safeLimit}:${trimmed}`],
      SEARCH_TIMEOUT_MS,
      'YouTube search',
    );
    return this.parseJsonLines(stdout).map((obj) => this.toSearchResult(obj));
  }

  /**
   * Lists a remote playlist without downloading anything. `--flat-playlist` keeps
   * this to one request per playlist instead of one per item, which matters when
   * auto-sync polls the same list on a schedule.
   */
  async listPlaylistEntries(url: string): Promise<RemotePlaylistEntry[]> {
    const stdout = await this.run(
      ['--flat-playlist', '--dump-json', '--ignore-errors', url],
      PLAYLIST_TIMEOUT_MS,
      'playlist listing',
    );

    const entries: RemotePlaylistEntry[] = [];
    for (const obj of this.parseJsonLines(stdout)) {
      const id = obj.id === undefined || obj.id === null ? '' : String(obj.id);
      const entryUrl = (obj.url as string) ?? (obj.webpage_url as string) ?? '';
      if (!entryUrl && !id) continue;
      entries.push({
        id,
        title: String(obj.title ?? 'Untitled'),
        // A flat listing may give a bare id for YouTube items; normalize to a URL
        // the downloader (and the stored source_url) can actually use.
        url: entryUrl.startsWith('http') ? entryUrl : `https://www.youtube.com/watch?v=${id}`,
      });
    }
    return entries;
  }

  private toSearchResult(obj: Record<string, unknown>): MediaSearchResult {
    const thumbnails = obj.thumbnails as Array<{ url: string }> | undefined;
    return {
      id: String(obj.id),
      title: String(obj.title ?? 'Untitled'),
      duration: typeof obj.duration === 'number' ? obj.duration : null,
      channel: (obj.channel as string) ?? (obj.uploader as string) ?? null,
      thumbnail: thumbnails?.[0]?.url ?? null,
      url: (obj.webpage_url as string) ?? `https://www.youtube.com/watch?v=${String(obj.id)}`,
    };
  }

  private parseJsonLines(stdout: string): Record<string, unknown>[] {
    const results: Record<string, unknown>[] = [];
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        results.push(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        // yt-dlp interleaves the odd non-JSON notice; skip it.
      }
    }
    return results;
  }

  /** Resolves with stdout, or with '' if yt-dlp is missing, fails or hangs. */
  private run(args: string[], timeoutMs: number, label: string): Promise<string> {
    return new Promise((resolve) => {
      let stdout = '';
      let settled = false;
      const proc = spawn(this.ytdlpPath, args);

      const finish = (value: string) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const timer = setTimeout(() => {
        this.logger.warn(`${label} timed out after ${timeoutMs}ms`);
        proc.kill('SIGKILL');
        finish(stdout);
      }, timeoutMs);
      timer.unref();

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', () => {});

      proc.on('close', () => { clearTimeout(timer); finish(stdout); });
      proc.on('error', (e) => {
        clearTimeout(timer);
        this.logger.warn(`${label} failed: ${e.message}`);
        finish('');
      });
    });
  }
}
