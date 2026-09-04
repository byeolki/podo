/**
 * yt-dlp handles well over a thousand sites, so Podo doesn't maintain an
 * allowlist — anything yt-dlp accepts is accepted here. These helpers exist only
 * to *label* a URL in the UI and to decide whether it points at a single item or
 * at a whole playlist.
 */

export type Provider =
  | 'youtube'
  | 'twitter'
  | 'soundcloud'
  | 'bandcamp'
  | 'vimeo'
  | 'tiktok'
  | 'instagram'
  | 'twitch'
  | 'niconico'
  | 'bilibili'
  | 'other';

const HOST_PATTERNS: Array<[RegExp, Provider]> = [
  [/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i, 'youtube'],
  [/(^|\.)(twitter\.com|x\.com|t\.co)$/i, 'twitter'],
  [/(^|\.)soundcloud\.com$/i, 'soundcloud'],
  [/(^|\.)bandcamp\.com$/i, 'bandcamp'],
  [/(^|\.)vimeo\.com$/i, 'vimeo'],
  [/(^|\.)tiktok\.com$/i, 'tiktok'],
  [/(^|\.)instagram\.com$/i, 'instagram'],
  [/(^|\.)twitch\.tv$/i, 'twitch'],
  [/(^|\.)(nicovideo\.jp|nico\.ms)$/i, 'niconico'],
  [/(^|\.)bilibili\.com$/i, 'bilibili'],
];

export const PROVIDER_LABELS: Record<Provider, string> = {
  youtube: 'YouTube',
  twitter: 'X / Twitter',
  soundcloud: 'SoundCloud',
  bandcamp: 'Bandcamp',
  vimeo: 'Vimeo',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  twitch: 'Twitch',
  niconico: 'niconico',
  bilibili: 'bilibili',
  other: 'Link',
};

export function providerFor(url: string): Provider {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return 'other';
  }
  for (const [pattern, provider] of HOST_PATTERNS) {
    if (pattern.test(host)) return provider;
  }
  return 'other';
}

/**
 * Whether a URL names a collection rather than one item.
 *
 * This matters because yt-dlp's default is to follow a playlist: a plain
 * `watch?v=...&list=...` link — what you get from "share" on a video that
 * happens to sit in a playlist — would otherwise pull the entire playlist. So
 * single items are downloaded with `--no-playlist`, and only URLs that clearly
 * mean "the whole collection" are allowed to expand.
 */
export function looksLikePlaylist(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const path = parsed.pathname.toLowerCase();
  const provider = providerFor(url);

  if (provider === 'youtube') {
    // /playlist?list=..., or a channel/user page. A `v=` parameter means the URL
    // names one video, whatever else it carries.
    if (parsed.searchParams.has('v')) return false;
    if (path.startsWith('/playlist')) return parsed.searchParams.has('list');
    return /^\/(@|c\/|channel\/|user\/)/.test(path) || path.endsWith('/videos');
  }
  if (provider === 'soundcloud') return path.includes('/sets/');
  if (provider === 'bandcamp') return path.startsWith('/album') || path === '/' || path === '/music';
  if (provider === 'vimeo') return path.includes('/album/') || path.includes('/showcase/');

  return /\/(playlist|sets|album|collection)(\/|$)/.test(path);
}
