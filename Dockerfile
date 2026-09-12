FROM node:22-slim AS web-builder
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ .
RUN npm run build

FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runner
# `curl-cffi` is what lets yt-dlp impersonate a real browser's TLS fingerprint.
# It is not optional in practice: without it YouTube answers subtitle requests
# with `HTTP Error 429: Too Many Requests` on the very first try, so every
# download imports with no lyrics.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 python3-pip \
    && pip3 install --no-cache-dir --break-system-packages "yt-dlp[default,curl-cffi]" \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# The second AI provider. Installed here so the feature is available out of the
# box, but it still needs credentials to do anything: set ANTHROPIC_API_KEY, or
# mount an authenticated config at /root/.claude. With neither, the server
# reports the provider as unavailable and every AI feature stays a no-op.
RUN npm install -g @anthropic-ai/claude-code && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=web-builder /web/dist ./public
RUN mkdir -p /data/uploads /data/artwork /data/transcode-cache
ENV NODE_ENV=production \
    DB_PATH=/data/podo.db \
    UPLOAD_DIR=/data/uploads \
    ARTWORK_DIR=/data/artwork \
    TRANSCODE_CACHE_DIR=/data/transcode-cache \
    STATIC_DIR=/app/public \
    MIGRATIONS_PATH=/app/dist/db/migrations \
    PORT=3000 \
    HOST=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
CMD ["node", "dist/main"]
