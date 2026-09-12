# Podo — architecture notes

Internal reference for people changing the code. The [README](../README.md) covers
deployment and the public API surface; this file covers how the pieces fit and the
invariants that aren't obvious from any single file.

## Layout

```
src/
  main.ts            bootstrap: static SPA, helmet/CSP, rate limits, CORS, swagger
  app.module.ts      module wiring; JwtAuthGuard is registered globally here
  config/            all env parsing, in one place
  common/            guards, decorators, filters, interceptors, id generation
  db/                drizzle schema + migrations + the DI-provided connection
  library/           filesystem scanning, watching, ffprobe, tag/MusicBrainz metadata
  tracks/            the canonical track read model + metadata overrides
  albums/ search/ playlists/ favorites/ history/ radio/
  streaming/         range serving, ffmpeg transcode, transcode cache
  broadcast/         public token-authenticated looping playlist streams
  download/          yt-dlp downloads and YouTube search
  upload/ admin/ auth/ ai/ sync/ health/
web/                 React + Vite SPA, served by the same process in production
```

Everything is one process. There is no external queue, cache or search service:
p-queue covers job scheduling, SQLite FTS5 covers search, and the transcode cache
is a directory.

## Request lifecycle

1. `JwtAuthGuard` is a global `APP_GUARD`, so **every route is authenticated by
   default**. Opting out is explicit: `@Public()`. Currently public are `/health`,
   the auth endpoints, `GET /artwork/:id`, `GET /playlists/public` and
   `GET /broadcast/:token`. Artwork is public because `<img>` can't send an
   Authorization header; the others are either credential exchanges or
   token-authenticated in their own right.
2. Role checks are *not* global — a handler that must be admin-only needs
   `@UseGuards(RolesGuard) @AdminOnly()`. Forgetting it is a silent privilege leak,
   so check for it whenever you add an admin route.
3. Tokens arrive as `Authorization: Bearer`, or as a `?token=` query parameter.
   The query fallback exists because `<audio>`, `<img>` and `AVPlayer` can't set
   headers; it means access tokens can land in proxy access logs, which is why
   they're short-lived and refresh tokens are never accepted this way.
4. `GlobalExceptionFilter` doubles as the SPA fallback: an unmatched non-`/api/`
   GET is answered with `index.html` so client-side routes resolve. Fastify only
   allows one `setNotFoundHandler` and Nest already owns it, hence the filter.

## Data model

A **track** is the logical song — playlists, favorites and history all reference
it. A **source** is one physical file (`media_kind` audio or video). One track can
have several sources; files in the same directory sharing a filename stem
(`song.mp3` + `song.mp4`) are attached to the same track, which is what makes a
music video play alongside its audio.

Metadata is layered:

- `tracks.*` — what the scanner read from the file (optionally LLM-assisted).
- `track_metadata_overrides.*` — what a user typed. **Always wins.** A rescan
  never touches this table.

Because of that layering, *any* endpoint returning tracks must resolve the
override or an edited title silently reverts to the raw filename. That resolution
lives in exactly one place: `TracksService.enrich`, reached via `findAll` /
`findByIds`. Favorites, playlists, albums and radio all go through `findByIds` for
this reason — do not `select().from(tracks)` directly in a new list endpoint.

Artist names are plain text on the track (`tracks.artist`, plus `artist` /
`original_artist` override columns). There is no artists table and no artist
browsing; "artists" in search results are just distinct names.

For covers the two columns mean different things and both clients render them the
same way: `artist` is who performed *this* recording, `original_artist` is who the
song is a cover *of*, and a row reads "Performer · cover of Original".

Deletes are soft (`deleted_at`) for tracks, sources and playlists, so every read
path filters on `isNull(deleted_at)`.

## Scanning

`ScannerService.scanRoot` walks the root, then hands every file to a
`p-queue` (concurrency 4) — ffprobe and the optional AI call dominate the cost and
are mostly waiting, so that concurrency is what makes a large library finish.

An unchanged file is skipped by comparing `file_size` plus a hash of the leading
64KB against the stored source row. Full-file hashing would read the entire
library on every scan for no extra signal.

`WatcherService` (chokidar) keeps the library live. `awaitWriteFinish` matters:
a file still being copied or downloaded would otherwise be probed while truncated.

## Streaming

`StreamingService.resolveSource` picks the source: an explicit `source_id`, else
the lowest `priority` available source of the requested `media_kind`, verifying
the file exists and marking it unavailable when it doesn't. **Clients that rank
sources themselves must sort ascending by `priority` to match.**

A request is served as a byte-range passthrough unless it asks for a different
format/bitrate, asks for `normalize`, or the track carries a manual `volume_db`
override — those go through ffmpeg. Transcoded output is fanned out with two
`pipe()` destinations (the client and the cache file) so backpressure from a slow
client throttles ffmpeg instead of buffering the transcode in memory.

Cache entries are written to a `.part` file and renamed into place only on a clean
exit. A concurrent request for the same key therefore misses and transcodes its
own copy rather than streaming a half-written file; leftover `.part` files from a
crash are swept at startup.

`stream_sessions.bytes_sent` is counted by a `Transform` in front of the response
body — that column is what the admin traffic view reads.

## Playlist auto-sync

`playlist_subscriptions` links a playlist to a remote playlist URL (at most one
per playlist, hence `playlist_id` as the primary key). `PlaylistSyncService` runs
a scheduler tick every minute and syncs whatever is past its interval,
sequentially — each sync can spawn yt-dlp downloads, and running several at once
just multiplies that against one CPU.

Two invariants worth keeping:

- **One-way and additive.** Remote entries are downloaded and appended; nothing
  local is ever deleted. A video disappearing upstream must not delete the copy
  the user kept.
- **Dedupe is by `sources.source_url`.** The downloader records the canonical
  per-item URL, so re-syncing an N-track playlist costs one `--flat-playlist`
  listing and zero downloads. Never dedupe by title.

Entries are downloaded one at a time with `allowPlaylist: false` — the listing
already expanded the playlist, so letting yt-dlp expand it again per entry would
re-download everything, N times over.

Reading a subscription needs playlist ownership; creating, changing or running
one needs admin, because it pulls files onto the server and that's the bar
`POST /download` already sets.

## Downloads and providers

`src/download/providers.ts` classifies a URL, for two reasons only: to label it
in the UI, and to decide whether it names one item or a collection. There is no
site allowlist — whatever yt-dlp accepts is accepted.

`looksLikePlaylist` matters more than it looks: yt-dlp follows playlists by
default, so a plain `watch?v=…&list=…` share link would otherwise drag in the
entire playlist. Single items are fetched with `--no-playlist`; only URLs that
clearly mean "the whole collection" get `--yes-playlist`.

**Sidecars run separately, after the media.** The thumbnail and the subtitle
tracks are fetched by their own `--skip-download` passes rather than as extra
flags on the download itself. yt-dlp exits non-zero when a sidecar fails, so
while they rode along, a single `HTTP Error 429` on one subtitle language failed
the whole job and discarded audio that had already downloaded successfully.
Each pass is independently best-effort: a failure is logged at debug and the
import proceeds. Subtitle requests are paced with `--sleep-subtitles` and retried
on rate limiting, and the image installs `curl-cffi` so yt-dlp can impersonate a
browser — without it YouTube refuses subtitle requests outright.

Only manually-uploaded subtitles are taken (`--write-subs`, never
`--write-auto-subs`): auto-generated captions are ASR output, not lyrics.
`ScannerService.parseVttToLrc` converts the cues to LRC and stores one row per
language; a row a user edited is never overwritten by a re-download.

**Refreshing a source.** `DownloadService.refreshTrack` re-downloads from
`sources.source_url`. The invariant is that the *track* row survives — playlists,
favorites and play counts all reference it — so the new file takes over the
existing source row instead of being scanned in as a new one. Concretely: the
download lands in a staging directory (a partial re-fetch must not be able to
destroy the copy that currently plays), the sidecars are fetched, the file
replaces the old locator (the extension may legitimately change, so the stem is
preserved and the source row is repointed *before* the scan), and the scan runs
with `force: true` — an unchanged media file can still come back with a new
thumbnail or newly-added subtitles, which the normal size+hash skip would
otherwise step over.

## AI

`src/ai` holds a provider abstraction over two backends: the OpenAI API, and the
Claude Code CLI run as a subprocess. The second exists so a self-hosted server
can have these features without its operator provisioning an API key; the cost is
a process per call, so every path is best-effort and nothing is on the critical
path of importing or finding music.

Settings live in `app_settings` under the key `ai`, seeded from environment
variables the first time they're read — env supplies the *defaults*, a row wins.
The model is free text everywhere, deliberately: pointing the server at a newer
model shouldn't need a release.

`available` can only tell you the provider is installed. An unauthenticated
Claude Code CLI passes `--version` happily and then answers "Not logged in" on
the first real call, and proving otherwise would cost a model call per status
check — so `AiService` records the last real failure instead and the dashboard
shows it.

**The assistant** (`ai-chat.service.ts`) uses a JSON protocol in the prompt
rather than a provider's native function calling, because the two providers don't
share one — the CLI is driven by a single prompt with no tool API. One protocol
keeps both providers on the same path and keeps the loop here, where it is
bounded (`MAX_TOOL_STEPS`) and auditable, instead of inside a vendor SDK. Tools
are scoped to the calling user and read or write only their own library and
playlists.

Playback is the one thing it can't do: the server has no speaker. So a reply
carries *actions* the browser performs, which also means the queue visibly
changes rather than the assistant claiming it did.

`AiModule` is deliberately importless. The scanner depends on it for the metadata
fill, so anything imported there ends up upstream of the library — which is how
the assistant (playlists → downloads → library → ai) first produced a module
cycle. It lives in `AiChatModule` for that reason.

## Command line client

`cli/podo.mjs` is a dependency-free Node script, exposed as the `podo` bin. It
exists for the one thing a browser is bad at: a lot of large files. Uploads are
streamed with a hand-built multipart body rather than `FormData`, because
`FormData` reads the file into memory to compute its length — exactly what the
command exists to avoid.

Two things it has to know about the server: uploads are stored with a timestamp
prefix (`1789223942895_Song.flac`), so skipping what is already there compares
names with that stripped; and `/auth/refresh` shares the strict credential rate
limit, so the token is renewed only when it is close to expiring rather than per
file.

## Broadcast (radio URLs)

A playlist can be exposed as a permanent public stream. One long-lived ffmpeg
*encoder* is fed PCM by a succession of per-track *decoders*: restarting the
encoder between tracks corrupts the output at track boundaries, which is why the
two halves are split. Revoking a token kills its live sessions immediately.

## Sync

`GET /sync?since=` returns rows changed after the cursor. The next cursor is
sampled *before* the reads, so concurrent writes are handed out again on the next
call — the cursor may lag, but it must never skip.

## Update check

`UpdateService` asks the GitHub releases API for the newest tag, caches it for
12 hours, and compares it against `app_version` (read from package.json, or
`APP_VERSION`). Three properties it has to keep:

- **Nothing about the instance leaves.** One unauthenticated GET; the only
  header is a User-Agent naming the software. Self-hosters notice this kind of
  thing, and rightly.
- **Never on the critical path.** Lazily refreshed, never at startup, and a
  failure keeps serving the last known answer rather than surfacing an error
  every time an admin opens Settings.
- **Fully switchable.** `UPDATE_CHECK_ENABLED=false` means no request is ever
  made, not that the result is hidden.

`compareVersions` ignores pre-release suffixes, so `1.2.3-rc1` and `1.2.3` are
the same version — an rc shouldn't advertise itself as an upgrade over the
release it precedes.

## Conventions

- 2-space indent, single quotes, semicolons.
- Services own the SQL; controllers only validate and delegate.
- `snake_case` in the database and on the wire; the clients decode accordingly.
- Timestamps are `timestamp_ms` integers; media durations are milliseconds.
- Config is read via `ConfigService`, never `process.env`, outside `config/`.

## Verifying a change

```bash
npm run typecheck      # server
npm run build          # server (nest build)
cd web && npm run build   # client (tsc -b && vite build)
```

There is no automated test suite yet; those three are the gate.
