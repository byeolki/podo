import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';

export interface UpdateStatus {
  /** Version this instance is running. */
  current: string;
  /** Newest published release, or null when the check is off or hasn't succeeded. */
  latest: string | null;
  update_available: boolean;
  release_url: string | null;
  published_at: string | null;
  /** Release notes, truncated — enough to decide whether to bother. */
  notes: string | null;
  /** False when `UPDATE_CHECK_ENABLED=false`; nothing is ever fetched then. */
  enabled: boolean;
  checked_at: string | null;
  error: string | null;
}

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_NOTES_LENGTH = 2000;

/**
 * Tells an admin when a newer Podo has been released.
 *
 * Deliberately minimal about what leaves the machine: one unauthenticated GET
 * to the GitHub releases API, no version, instance id, or anything else sent —
 * GitHub learns only that some IP asked what the latest release is. It can be
 * turned off entirely with `UPDATE_CHECK_ENABLED=false`, and it is never on the
 * critical path: the result is cached, refreshed lazily, and any failure just
 * leaves the last known answer in place.
 */
@Injectable()
export class UpdateService {
  private readonly logger = new Logger(UpdateService.name);
  private readonly enabled: boolean;
  private readonly currentVersion: string;
  private readonly repo: string;

  private cached: UpdateStatus | null = null;
  private lastCheckedAt = 0;
  private inFlight: Promise<UpdateStatus> | null = null;

  constructor(private readonly config: ConfigService) {
    this.enabled = config.get<boolean>('update_check_enabled', true);
    this.currentVersion = config.get<string>('app_version', '0.0.0');
    this.repo = config.get<string>('update_check_repo', 'byeolki/podo');
  }

  /** Cached result; refreshes in the background once the cache is stale. */
  async getStatus(force = false): Promise<UpdateStatus> {
    if (!this.enabled) {
      return this.offlineStatus(null);
    }
    const fresh = Date.now() - this.lastCheckedAt < CHECK_INTERVAL_MS;
    if (this.cached && fresh && !force) return this.cached;
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.check().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async check(): Promise<UpdateStatus> {
    try {
      const release = await this.fetchLatestRelease();
      const latest = release.tag_name.replace(/^v/i, '');
      const status: UpdateStatus = {
        current: this.currentVersion,
        latest,
        update_available: compareVersions(latest, this.currentVersion) > 0,
        release_url: release.html_url ?? null,
        published_at: release.published_at ?? null,
        notes: release.body ? release.body.slice(0, MAX_NOTES_LENGTH) : null,
        enabled: true,
        checked_at: new Date().toISOString(),
        error: null,
      };
      this.cached = status;
      this.lastCheckedAt = Date.now();
      if (status.update_available) {
        this.logger.log(`Update available: ${status.current} → ${latest}`);
      }
      return status;
    } catch (e) {
      const message = (e as Error).message;
      this.logger.debug(`Update check failed: ${message}`);
      // Keep serving the last good answer; a server with no outbound network
      // shouldn't surface a scary error every time the settings page opens.
      this.lastCheckedAt = Date.now();
      return this.cached ?? this.offlineStatus(message);
    }
  }

  private offlineStatus(error: string | null): UpdateStatus {
    return {
      current: this.currentVersion,
      latest: null,
      update_available: false,
      release_url: null,
      published_at: null,
      notes: null,
      enabled: this.enabled,
      checked_at: null,
      error,
    };
  }

  private fetchLatestRelease(): Promise<{
    tag_name: string;
    html_url?: string;
    published_at?: string;
    body?: string;
  }> {
    const url = `https://api.github.com/repos/${this.repo}/releases/latest`;
    return new Promise((resolve, reject) => {
      const req = https.get(
        url,
        {
          headers: {
            // GitHub rejects requests without a User-Agent. It identifies the
            // software, not this installation.
            'User-Agent': `podo/${this.currentVersion}`,
            Accept: 'application/vnd.github+json',
          },
        },
        (res) => {
          if (res.statusCode === 404) {
            res.resume();
            reject(new Error('No published releases yet'));
            return;
          }
          if ((res.statusCode ?? 0) >= 300) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode} from GitHub`));
            return;
          }
          let body = '';
          res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(body) as { tag_name?: string };
              if (!parsed.tag_name) throw new Error('Release has no tag');
              resolve(parsed as { tag_name: string });
            } catch (err) {
              reject(err as Error);
            }
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error('Update check timed out'));
      });
    });
  }
}

/**
 * Compares two dotted versions, ignoring any pre-release suffix. Returns >0 when
 * `a` is newer. Small enough not to warrant a semver dependency, and the only
 * shapes it ever sees are release tags this project publishes.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v.split('-')[0].split('.').map((part) => parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
