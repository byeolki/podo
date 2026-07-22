<p align="center">
  <img src="docs/podo_lg.png" alt="Podo" width="120" />
</p>

# Podo

Self-hosted music streaming server. One container, no external dependencies.

## Deploy (using published image)

```bash
cd deploy
cp .env.example .env
# Edit .env — set JWT_SECRET

# Edit docker-compose.yml:
#   image: ghcr.io/byeolki/podo:latest
#   volumes: point to your actual music and data paths

docker compose up -d
```

On first run, create the admin account:

```bash
curl -X POST http://localhost:3000/api/v1/auth/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"name":"Admin","email":"admin@example.com","password":"changeme"}'
```

## Build from source

```bash
cp .env.example .env
docker compose up -d
```

Or run locally without Docker:

```bash
npm install
cp .env.example .env   # edit as needed
npm run start:dev
```

## Environment variables

| Variable                 | Default                   | Description                                                               |
| ------------------------ | ------------------------- | ------------------------------------------------------------------------- |
| `JWT_SECRET`             | `change-me-in-production` | **Required in production**                                                |
| `JWT_ACCESS_EXPIRES_IN`  | `15m`                     | Access token lifetime                                                     |
| `JWT_REFRESH_EXPIRES_IN` | `30d`                     | Refresh token lifetime                                                    |
| `PORT`                   | `3000`                    | HTTP port                                                                 |
| `HOST`                   | `0.0.0.0`                 | Bind address                                                              |
| `DB_PATH`                | `./data/podo.db`          | SQLite database path                                                      |
| `LIBRARY_ROOTS`          | _(empty)_                 | Comma-separated paths to scan on startup                                  |
| `UPLOAD_DIR`             | `./data/uploads`          | Uploaded files storage                                                    |
| `ARTWORK_DIR`            | `./data/artwork`          | Artwork image storage                                                     |
| `TRANSCODE_CACHE_DIR`    | `./data/transcode-cache`  | Transcoding segment cache                                                 |
| `STATIC_DIR`             | `./web/dist`              | Web client static files (Docker image sets this to `/app/public`)        |
| `CORS_ORIGIN`            | `*`                       | Allowed CORS origin(s)                                                    |
| `TRUST_PROXY`            | `true`                    | Trust `X-Forwarded-*` headers (set `false` if not behind a reverse proxy) |
| `RATE_LIMIT_MAX`         | `1000`                    | Global requests per minute per IP                                         |
| `AUTH_RATE_LIMIT_MAX`    | `10`                      | Login/register/refresh attempts per minute per IP                         |
| `SWAGGER_ENABLED`        | _(dev only)_              | Set `true` to expose `/api/docs` in production                            |
| `OPENAI_API_KEY`         | _(empty)_                 | Enables AI metadata extraction on scan                                    |
| `OPENAI_MODEL`           | `gpt-4o-mini`             | Model used for AI metadata extraction                                     |
| `YTDLP_PATH`             | `yt-dlp`                  | Path to the yt-dlp binary for URL downloads                               |

## API

Full OpenAPI spec at `/api/docs` (development; set `SWAGGER_ENABLED=true` to expose it in production).

Base path: `/api/v1`

Key endpoints:

- `POST /api/v1/auth/bootstrap` — create first admin (one-time)
- `POST /api/v1/auth/login` — get access + refresh tokens
- `POST /api/v1/auth/invite` — generate invite token (admin); registration requires one
- `GET/PATCH /api/v1/auth/me` — self-service account (display name, password)
- `GET  /api/v1/tracks` — browse library
- `GET  /api/v1/stream/{track_id}` — stream with HTTP Range support
- `GET  /api/v1/tracks/{id}/lyrics` — synced lyrics per language, when available
- `GET  /api/v1/search?q=` — full-text search
- `POST /api/v1/upload` — upload audio/video files (any authenticated user)
- `GET/PATCH/DELETE /api/v1/upload/files[/{source_id}]` — list, rename, delete own uploads
- `GET/PATCH/DELETE /api/v1/admin/files[/{source_id}]` — admin file browser over all uploads
- `GET  /api/v1/admin/storage` — per-directory usage + disk capacity
- `POST /api/v1/download` — download from a URL via yt-dlp (audio-only or video); auto-fetches a thumbnail and any manually-uploaded subtitle tracks as lyrics
- `GET  /api/v1/download/search?q=` — search the local library first, then YouTube
- `POST /api/v1/playlists/{id}/tracks` — append tracks to a playlist
- `POST/GET/DELETE /api/v1/playlists/{id}/radio-tokens` — generate/list/revoke a public, infinitely-looping stream URL for a playlist (choice of codec, optional shuffle); admins can list/force-close any token via `/api/v1/admin/radio-tokens`
- `GET  /api/v1/broadcast/{token}` — the public radio stream itself (no auth)
- `GET  /api/v1/radio/station?seed_artist_name=` — auto-generated station
- `GET  /api/v1/sync?since=` — delta sync cursor
- `GET  /health` — Docker healthcheck

## Real-time events

Connect via Socket.IO to `/api/v1/events` with `{ auth: { token: "<access_token>" } }`.

Events emitted: `track.upserted`, `source.removed`, `scan.started`, `scan.progress`, `scan.completed`, `scan.failed`, `download.started`, `download.progress`, `download.completed`, `download.failed`.

## Architecture

- **NestJS + Fastify** — HTTP server
- **SQLite + Drizzle ORM** — WAL mode, FTS5 full-text search built in
- **ffmpeg/ffprobe** — media probing, thumbnail extraction, and on-the-fly transcoding
- **yt-dlp** — reused for both URL downloads and YouTube search (no separate API key)
- **p-queue** — in-process job queue (no Redis required)
- **chokidar** — filesystem watch for instant library updates

### Track ↔ Source model

A _Track_ is a logical song (what playlists, favorites, and history reference).
A _Source_ is a physical file — local audio or video. One track can have multiple sources.
Streaming resolves the best available source by `media_kind` and `priority`.
Files in the same directory sharing a filename stem (e.g. `song.mp3` + `song.mp4`)
are attached to the same track, so a music video plays alongside its audio.

Metadata has a base layer (ID3 tags, optionally enriched by an LLM when `OPENAI_API_KEY`
is set) with a user override layer on top. User edits always win — automatic sources never
overwrite manual input. Free-text alternate titles can be attached per track so search still
finds it when written in a different script (e.g. "Yonezu Kenshi" vs "米津玄師").

Artist names live directly on the track (`tracks.artist`, with `artist` / `original_artist`
override columns for covers) — there is no separate artists table or browsing tab.

Tracks with a video source get a thumbnail — either the source's own thumbnail (when
downloaded via yt-dlp) or the first extracted frame (via ffmpeg) as a fallback. Videos
downloaded via yt-dlp also carry the exact URL they came from, and any manually-uploaded
subtitle track is captured as synced, per-language lyrics (auto-generated captions are
skipped as unreliable).

A playlist can also be exposed as a permanent public radio stream (`/radio-tokens`) that
loops forever in a chosen codec, independent of any playback session — built on a single
persistent ffmpeg encoder fed by per-track decoders, since restarting the encoder between
tracks corrupts the output at track boundaries.

## Security

- Invite-only registration — accounts require an admin-issued invite token; `bootstrap` only works while the server has zero users
- JWT auth with short-lived access tokens and revocable refresh tokens (bcrypt-hashed at rest); production refuses to start with the default `JWT_SECRET`
- Security headers via helmet (CSP, X-Frame-Options, etc.)
- Global per-IP rate limiting plus a stricter limit on credential endpoints (`RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`)
- Upload hardening: extension allowlist, 500MB size cap, filename sanitization; non-admins can only rename/delete their own uploads
- Swagger UI disabled in production unless `SWAGGER_ENABLED=true`

## License

AGPL-3.0
