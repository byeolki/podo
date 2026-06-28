import * as path from 'path';

export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  host: process.env.HOST ?? '0.0.0.0',
  db_path: process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'podo.db'),
  jwt_secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
  jwt_access_expires_in: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  jwt_refresh_expires_in: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  library_roots: (process.env.LIBRARY_ROOTS ?? '').split(',').filter(Boolean),
  upload_dir: process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'data', 'uploads'),
  artwork_dir: process.env.ARTWORK_DIR ?? path.join(process.cwd(), 'data', 'artwork'),
  transcode_cache_dir: process.env.TRANSCODE_CACHE_DIR ?? path.join(process.cwd(), 'data', 'transcode-cache'),
  static_dir: process.env.STATIC_DIR ?? path.join(process.cwd(), 'public'),
  musicbrainz_user_agent: process.env.MUSICBRAINZ_USER_AGENT ?? 'podo/0.1.0',
  metrics_enabled: process.env.METRICS_ENABLED === 'true',
  migrations_path: process.env.MIGRATIONS_PATH ?? path.join(__dirname, '..', 'db', 'migrations'),
  openai_api_key: process.env.OPENAI_API_KEY ?? '',
  openai_model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  ytdlp_path: process.env.YTDLP_PATH ?? 'yt-dlp',
});
