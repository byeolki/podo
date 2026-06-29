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

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | `change-me-in-production` | **Required in production** |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | Refresh token lifetime |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DB_PATH` | `./data/podo.db` | SQLite database path |
| `LIBRARY_ROOTS` | *(empty)* | Comma-separated paths to scan on startup |
| `UPLOAD_DIR` | `./data/uploads` | Uploaded files storage |
| `ARTWORK_DIR` | `./data/artwork` | Artwork image storage |
| `TRANSCODE_CACHE_DIR` | `./data/transcode-cache` | Transcoding segment cache |
| `STATIC_DIR` | `./public` | Web client static files |
| `MUSICBRAINZ_USER_AGENT` | `podo/0.1.0` | User-Agent for MusicBrainz requests |
| `METRICS_ENABLED` | `false` | Expose `/metrics` Prometheus endpoint |

## API

Full OpenAPI spec at `/api/docs`.

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

Events emitted: `track.upserted`, `track.removed`, `scan.started`, `scan.progress`, `scan.completed`.

## Architecture

- **NestJS + Fastify** — HTTP server
- **SQLite + Drizzle ORM** — WAL mode, FTS5 full-text search built in
- **ffmpeg/ffprobe** — media probing and on-the-fly transcoding
- **p-queue** — in-process job queue (no Redis required)
- **chokidar** — filesystem watch for instant library updates

### Track ↔ Source model

A *Track* is a logical song (what playlists, favorites, and history reference).
A *Source* is a physical file — local audio or video. One track can have multiple sources.
Streaming resolves the best available source by `media_kind` and `priority`.

Metadata has a base layer (ID3 → MusicBrainz → Last.fm) with a user override layer on top.
User edits always win — automatic sources never overwrite manual input.

## License

AGPL-3.0
