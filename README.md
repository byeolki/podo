# Podo

Self-hosted music streaming server. One container, no external dependencies.

## Quick start

```bash
cp .env.example .env
# Edit .env — set JWT_SECRET and MUSIC_DIR at minimum

docker compose up -d
```

Open `http://localhost:3000/api/docs` for the OpenAPI UI.

On first run, create the admin account:

```bash
curl -X POST http://localhost:3000/api/v1/auth/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"name":"Admin","email":"admin@example.com","password":"changeme"}'
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | `change-me-in-production` | **Required in production** — HMAC secret for tokens |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | Refresh token lifetime |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DB_PATH` | `./data/podo.db` | SQLite database path |
| `LIBRARY_ROOTS` | *(empty)* | Comma-separated paths to scan on startup |
| `UPLOAD_DIR` | `./data/uploads` | Uploaded files storage |
| `ARTWORK_DIR` | `./data/artwork` | Artwork image storage |
| `TRANSCODE_CACHE_DIR` | `./data/transcode-cache` | Transcoding segment cache |
| `STATIC_DIR` | `./public` | Web client static files (SPA) |
| `MUSICBRAINZ_USER_AGENT` | `podo/0.1.0` | User-Agent sent to MusicBrainz API |
| `METRICS_ENABLED` | `false` | Expose `/metrics` Prometheus endpoint |

## Volumes (docker compose)

| Volume | Purpose |
|---|---|
| `podo-data` | Database, uploads, artwork, transcode cache |
| `${MUSIC_DIR}:/music:ro` | Music library (read-only mount) |

Set `MUSIC_DIR` in your `.env` or shell to the path of your music folder.
After starting, add it via the API or let `LIBRARY_ROOTS=/music` auto-register it.

## API

Full OpenAPI spec is served at `/api/docs`.

Base path: `/api/v1`

Key endpoints:
- `POST /api/v1/auth/bootstrap` — create first admin (one-time)
- `POST /api/v1/auth/login` — get access + refresh tokens
- `GET  /api/v1/tracks` — browse library
- `GET  /api/v1/stream/{track_id}` — stream with HTTP Range support
- `GET  /api/v1/search?q=` — full-text search
- `GET  /api/v1/sync?since=` — delta sync cursor
- `GET  /health` — Docker healthcheck

## Real-time events

Connect via Socket.IO to `/api/v1/events` with `{ auth: { token: "<access_token>" } }`.

Events: `track.upserted`, `track.removed`, `scan.started`, `scan.progress`, `scan.completed`.

## Architecture

- **NestJS + Fastify** — HTTP server
- **SQLite + Drizzle ORM** — WAL mode, FTS5 full-text search
- **ffmpeg/ffprobe** — media probing and on-the-fly transcoding
- **p-queue** — in-process job queue (no Redis)
- **chokidar** — filesystem watch for instant library updates

### Track ↔ Source model

A *Track* is a logical song. A *Source* is a physical file (local audio or video).
One track can have multiple sources. Streaming resolves the best available source by `media_kind` and `priority`.

## License

AGPL-3.0
