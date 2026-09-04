<p align="center">
  <img src="docs/podo_lg.png" alt="Podo" width="120" />
</p>

<h1 align="center">Podo</h1>

<p align="center">
  <b>Your music library, on your own server.</b><br />
  One container. No Postgres, no Redis, no search cluster, no API keys.
</p>

<p align="center">
  <a href="https://github.com/byeolki/podo/actions/workflows/docker.yml"><img src="https://github.com/byeolki/podo/actions/workflows/docker.yml/badge.svg" alt="Build status" /></a>
  <a href="https://github.com/byeolki/podo/pkgs/container/podo"><img src="https://img.shields.io/badge/ghcr.io-podo-blue?logo=docker&logoColor=white" alt="Container image" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-green" alt="License: AGPL-3.0" /></a>
  <img src="https://img.shields.io/badge/node-22-339933?logo=nodedotjs&logoColor=white" alt="Node 22" />
</p>

---

Podo scans the music you already have, and streams it to a browser or to the
[Muscat](https://github.com/byeolki/muscat) app on your iPhone and Mac. It also
knows how to go get the music you *don't* have yet: paste a URL, or search
YouTube from inside the app, and it lands in your library with artwork and
synced lyrics attached.

It's built for a small group sharing one server — a household, a few friends —
so accounts are invite-only and everyone gets their own favorites, playlists and
history over the same library.

```bash
docker run -d -p 3000:3000 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e LIBRARY_ROOTS=/music \
  -v /path/to/music:/music:ro -v podo-data:/data \
  ghcr.io/byeolki/podo:latest
```

Then open `http://localhost:3000` and create the first admin account.

## Why it might suit you

**One process, one file.** SQLite in WAL mode is the database, SQLite FTS5 is the
search engine, p-queue is the job runner, a directory is the cache. There is
nothing else to deploy, back up, or keep upgraded — `data/` is the whole state.

**Your edits are permanent.** Scanned tags and (optionally) an LLM fill in what
they can, but they write to a base layer. Anything you type by hand goes in an
override layer on top, and no rescan, re-download or re-tag ever overwrites it.

**A song, not a file.** A track can have several sources: the FLAC and the music
video are one entry, not two. Drop `song.mp3` and `song.mp4` in the same folder
and Podo pairs them; the video button appears next to the track and plays in
sync with the audio.

**Made for libraries that aren't in English.** Alternate titles are free text per
track, so "米津玄師" is findable as "Kenshi Yonezu" or "Yonezu Kenshi". Search
also expands artist names through MusicBrainz aliases before it queries.

**Music you don't own yet.** yt-dlp is wired in for both downloading and
searching, so there's no second tool and no API key. Downloads keep the source
URL, pull the thumbnail, and turn manually-uploaded subtitle tracks into synced,
per-language lyrics — auto-generated captions are deliberately skipped as too
unreliable to call lyrics.

**A radio station out of any playlist.** Mint a permanent URL and paste it into
VLC, a network speaker, a Discord bot — anything that can open a stream. It loops
forever in the codec you pick, with no login and no playback session behind it.

## Features

| | |
|---|---|
| **Library** | Recursive scan with live filesystem watching, ffprobe metadata, album/version grouping, genres, soft deletes |
| **Playback** | HTTP Range streaming, on-the-fly ffmpeg transcode with a disk cache, ReplayGain/loudnorm normalization, per-track manual gain |
| **Video** | Music videos as a source of the same track, with thumbnail extraction |
| **Lyrics** | Synced (LRC-style) lyrics per language, imported from yt-dlp subtitle tracks |
| **Metadata** | ID3 tags → optional LLM fill → user override layer that always wins; multi-select AI autofill from the dashboard |
| **Search** | SQLite FTS5 over titles and albums, plus artist/alternate-title matching and MusicBrainz alias expansion |
| **Import** | Drag-and-drop upload, or yt-dlp by URL or YouTube search, with progress over websockets |
| **Sharing** | Invite-only accounts, public playlists, permanent public radio URLs per playlist |
| **Per user** | Favorites, playlists, play history, listening stats |
| **Clients** | Bundled React web dashboard + [Muscat](https://github.com/byeolki/muscat) for iOS/macOS |
| **Admin** | Library roots and scans, uploaded-file browser, storage and traffic stats, user management, radio token control |
| **Live** | Socket.IO events for scan and download progress, and a `/sync` cursor for delta sync |

## Install

### Docker (recommended)

```bash
cd deploy
cp .env.example .env      # set JWT_SECRET
# edit docker-compose.yml: point the volumes at your music and data paths
docker compose up -d
```

Create the first admin account — this only works while the server has zero users:

```bash
curl -X POST http://localhost:3000/api/v1/auth/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"name":"Admin","email":"admin@example.com","password":"changeme"}'
```

Everyone after that registers with an invite token an admin generates.

### From source

```bash
npm install
cp .env.example .env
npm run build:all         # web client + server
npm run start:prod
```

Requires Node 22, plus `ffmpeg`/`ffprobe` on PATH (and `yt-dlp` if you want URL
downloads). The Docker image bundles all three.

## Configuration

Everything is environment variables; the full list is in
[`.env.example`](.env.example). The ones that matter:

| Variable | Default | Description |
| --- | --- | --- |
| `JWT_SECRET` | `change-me-in-production` | **Required in production** — the server refuses to start with the default |
| `LIBRARY_ROOTS` | _(empty)_ | Comma-separated paths to scan on startup |
| `DB_PATH` | `./data/podo.db` | SQLite database |
| `UPLOAD_DIR` / `ARTWORK_DIR` / `TRANSCODE_CACHE_DIR` | `./data/*` | Where uploads, artwork and cached transcodes live |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | `15m` / `30d` | Token lifetimes |
| `CORS_ORIGIN` | `*` | Allowed origin(s) |
| `TRUST_PROXY` | `true` | Set `false` when not behind a reverse proxy |
| `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` | `1000` / `10` | Requests per minute per IP, globally and on credential endpoints |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | _(empty)_ / `gpt-4o-mini` | Enables LLM metadata extraction. Entirely optional — everything else works without it |
| `YTDLP_PATH` | `yt-dlp` | Binary used for downloads and YouTube search |
| `MUSICBRAINZ_USER_AGENT` | `podo/0.1.0` | Identify your deployment; a generic UA gets rate-limited |
| `SWAGGER_ENABLED` | _(dev only)_ | Set `true` to expose `/api/docs` in production |

## API

Full OpenAPI spec at `/api/docs` in development. Base path is `/api/v1`.

- `POST /auth/bootstrap` — create the first admin (one-time)
- `POST /auth/login` · `POST /auth/refresh` · `POST /auth/invite`
- `GET /tracks` · `GET /tracks/{id}` · `PATCH /tracks/{id}/metadata`
- `GET /stream/{track_id}` — HTTP Range, optional transcode/normalize
- `GET /tracks/{id}/lyrics` — synced lyrics, per language
- `GET /search?q=` · `GET /albums` · `GET /history` · `GET /stats/me`
- `POST /upload` · `POST /download` · `GET /download/search?q=`
- `GET/POST/PATCH/DELETE /playlists` · `POST /playlists/{id}/tracks`
- `POST /playlists/{id}/radio-tokens` → `GET /broadcast/{token}` (public stream)
- `GET /radio?seed_artist_name=` · `POST /radio/mix`
- `GET /sync?since=` — delta sync cursor
- `GET /health` — unauthenticated liveness probe

Real-time events over Socket.IO at `/api/v1/events` with
`{ auth: { token: "<access_token>" } }`: `track.upserted`, `source.removed`,
`scan.*`, `download.*`.

## Security

- Invite-only registration; `bootstrap` works only while the server has no users
- Short-lived JWT access tokens, revocable refresh tokens, bcrypt-hashed at rest
- Every route authenticated by default — public endpoints are opt-in, one by one
- Per-IP rate limiting, stricter on credential endpoints
- helmet security headers with a locked-down CSP
- Upload hardening: extension allowlist, size cap, filename sanitization;
  non-admins can only touch their own uploads
- Streaming and artwork accept a `?token=` query parameter, because `<audio>`,
  `<img>` and `AVPlayer` can't send headers — access tokens only, never refresh
  tokens

## Development

```bash
npm run typecheck         # tsc --noEmit
npm run build             # server
cd web && npm run dev     # SPA dev server, proxies /api to :3000
```

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the internal reference: module
map, the guard model, the metadata-override invariant, how scanning and the
transcode cache actually work. Read it before changing anything structural.

Issues and pull requests are welcome.

## Clients

- **Web** — bundled, served by the same process at `/`
- **[Muscat](https://github.com/byeolki/muscat)** — native iOS and macOS client:
  background audio, lock-screen and Control Center controls, Live Activity and
  Dynamic Island

## License

[AGPL-3.0](LICENSE). If you run a modified version as a network service, its
source has to be available to its users.
