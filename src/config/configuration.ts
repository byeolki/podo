import * as path from 'path';
import * as fs from 'fs';

/**
 * The running version, for the update check and the admin health view. Read from
 * package.json rather than hardcoded, so a release only has to bump one place;
 * `APP_VERSION` overrides it for builds that don't ship package.json.
 */
function appVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  // dist/config/ → ../../package.json in the image, ../../ in a source checkout.
  for (const candidate of ['../../package.json', '../../../package.json']) {
    try {
      const raw = fs.readFileSync(path.join(__dirname, candidate), 'utf-8');
      const version = (JSON.parse(raw) as { version?: string }).version;
      if (version) return version;
    } catch {
      // try the next candidate
    }
  }
  return '0.0.0';
}

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
  static_dir: process.env.STATIC_DIR ?? path.join(process.cwd(), 'web', 'dist'),
  musicbrainz_user_agent: process.env.MUSICBRAINZ_USER_AGENT ?? 'podo/0.1.0',
  migrations_path: process.env.MIGRATIONS_PATH ?? path.join(__dirname, '..', 'db', 'migrations'),
  // AI. These are the *defaults*; an admin can change provider, model and the
  // switches at runtime and those are stored in `app_settings`.
  // Opt-in, not opt-out: unset must mean off, or an upgrade silently switches AI
  // on for every existing deployment. `AiService` also treats naming a provider
  // or supplying a key as enabling it.
  ai_enabled: process.env.AI_ENABLED === 'true',
  ai_provider: process.env.AI_PROVIDER ?? '',
  ai_chat_enabled: process.env.AI_CHAT_ENABLED === 'true',
  openai_api_key: process.env.OPENAI_API_KEY ?? '',
  openai_model: process.env.OPENAI_MODEL ?? '',
  claude_code_path: process.env.CLAUDE_CODE_PATH ?? 'claude',
  ytdlp_path: process.env.YTDLP_PATH ?? 'yt-dlp',
  cors_origin: process.env.CORS_ORIGIN ?? '*',
  rate_limit_max: parseInt(process.env.RATE_LIMIT_MAX ?? '1000', 10),
  auth_rate_limit_max: parseInt(process.env.AUTH_RATE_LIMIT_MAX ?? '10', 10),
  app_version: appVersion(),
  // One unauthenticated GET to the GitHub releases API, nothing sent about this
  // instance. Off with UPDATE_CHECK_ENABLED=false.
  update_check_enabled: process.env.UPDATE_CHECK_ENABLED !== 'false',
  update_check_repo: process.env.UPDATE_CHECK_REPO ?? 'byeolki/podo',
  swagger_enabled: process.env.SWAGGER_ENABLED === 'true' || process.env.NODE_ENV !== 'production',
});
