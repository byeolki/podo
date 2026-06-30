import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  settings: text('settings', { mode: 'json' }).notNull().default('{}'),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
});

export const invite_tokens = sqliteTable('invite_tokens', {
  token: text('token').primaryKey(),
  created_by: text('created_by').notNull().references(() => users.id),
  used_by: text('used_by').references(() => users.id),
  used_at: integer('used_at', { mode: 'timestamp_ms' }),
  expires_at: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
});

export const refresh_tokens = sqliteTable('refresh_tokens', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token_hash: text('token_hash').notNull().unique(),
  expires_at: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
});

// ─── Artists ──────────────────────────────────────────────────────────────────

export const artists = sqliteTable('artists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  is_custom: integer('is_custom', { mode: 'boolean' }).notNull().default(false),
  external_ids: text('external_ids', { mode: 'json' }).notNull().default('{}'),
  created_by: text('created_by').references(() => users.id),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
}, (t) => [
  index('idx_artists_name').on(t.name),
]);

// ─── Albums ───────────────────────────────────────────────────────────────────

export const albums = sqliteTable('albums', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  primary_artist_id: text('primary_artist_id').references(() => artists.id),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
}, (t) => [
  index('idx_albums_primary_artist').on(t.primary_artist_id),
]);

export const album_versions = sqliteTable('album_versions', {
  id: text('id').primaryKey(),
  album_id: text('album_id').notNull().references(() => albums.id, { onDelete: 'cascade' }),
  version_type: text('version_type', {
    enum: ['regular', 'repackage', 'remaster', 'single', 'ep', 'compilation', 'live', 'other'],
  }).notNull().default('regular'),
  release_year: integer('release_year'),
  artwork_path: text('artwork_path'),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
}, (t) => [
  index('idx_album_versions_album').on(t.album_id),
]);

// ─── Tracks ───────────────────────────────────────────────────────────────────

export const tracks = sqliteTable('tracks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  album_version_id: text('album_version_id').references(() => album_versions.id),
  track_number: integer('track_number'),
  disc_number: integer('disc_number'),
  canonical_duration: integer('canonical_duration'),
  is_cover: integer('is_cover', { mode: 'boolean' }).notNull().default(false),
  original_artist_id: text('original_artist_id').references(() => artists.id),
  play_count: integer('play_count').notNull().default(0),
  added_by: text('added_by').references(() => users.id),
  added_at: integer('added_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
  deleted_at: integer('deleted_at', { mode: 'timestamp_ms' }),
}, (t) => [
  index('idx_tracks_album_version').on(t.album_version_id),
  index('idx_tracks_updated_at').on(t.updated_at),
]);

export const track_artists = sqliteTable('track_artists', {
  track_id: text('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  artist_id: text('artist_id').notNull().references(() => artists.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
  role: text('role', { enum: ['main', 'featuring'] }).notNull().default('main'),
}, (t) => [
  primaryKey({ columns: [t.track_id, t.artist_id] }),
  index('idx_track_artists_artist').on(t.artist_id),
]);

export const track_metadata_overrides = sqliteTable('track_metadata_overrides', {
  track_id: text('track_id').primaryKey().references(() => tracks.id, { onDelete: 'cascade' }),
  title: text('title'),
  artist: text('artist'),
  original_artist: text('original_artist'),
  is_cover: integer('is_cover', { mode: 'boolean' }),
  video_locator: text('video_locator'),
  track_number: integer('track_number'),
  disc_number: integer('disc_number'),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
  updated_by: text('updated_by').references(() => users.id),
});

// ─── Sources ──────────────────────────────────────────────────────────────────

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  track_id: text('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  media_kind: text('media_kind', { enum: ['audio', 'video'] }).notNull(),
  origin: text('origin', { enum: ['local', 'ytdlp'] }).notNull().default('local'),
  format: text('format'),
  codec: text('codec'),
  bitrate: integer('bitrate'),
  sample_rate: integer('sample_rate'),
  channels: integer('channels'),
  duration: integer('duration'),
  time_offset: integer('time_offset').notNull().default(0),
  priority: integer('priority').notNull().default(0),
  locator: text('locator').notNull(),
  file_hash: text('file_hash'),
  file_size: integer('file_size'),
  replaygain_track: real('replaygain_track'),
  replaygain_album: real('replaygain_album'),
  available: integer('available', { mode: 'boolean' }).notNull().default(true),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
  deleted_at: integer('deleted_at', { mode: 'timestamp_ms' }),
}, (t) => [
  index('idx_sources_track').on(t.track_id),
  uniqueIndex('idx_sources_locator').on(t.locator),
  index('idx_sources_available').on(t.available),
]);

// ─── Lyrics ───────────────────────────────────────────────────────────────────

export const lyrics = sqliteTable('lyrics', {
  track_id: text('track_id').primaryKey().references(() => tracks.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['plain', 'synced'] }).notNull(),
  content: text('content').notNull(),
  source: text('source', { enum: ['local', 'user'] }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
});

// ─── Tags / Genres ────────────────────────────────────────────────────────────

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['genre'] }).notNull().default('genre'),
}, (t) => [
  uniqueIndex('idx_tags_name_kind').on(t.name, t.kind),
]);

export const track_tags = sqliteTable('track_tags', {
  track_id: text('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  tag_id: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.track_id, t.tag_id] }),
]);

// ─── Cover mappings ───────────────────────────────────────────────────────────

export const cover_mappings = sqliteTable('cover_mappings', {
  id: text('id').primaryKey(),
  cover_track_id: text('cover_track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  original_track_id: text('original_track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  created_by: text('created_by').references(() => users.id),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
}, (t) => [
  uniqueIndex('idx_cover_mappings_unique').on(t.cover_track_id, t.original_track_id),
]);

// ─── Video ↔ Audio mapping queue ─────────────────────────────────────────────

export const mapping_queue = sqliteTable('mapping_queue', {
  id: text('id').primaryKey(),
  audio_source_id: text('audio_source_id').references(() => sources.id, { onDelete: 'cascade' }),
  video_source_id: text('video_source_id').references(() => sources.id, { onDelete: 'cascade' }),
  confidence: real('confidence').notNull(),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
  reviewed_by: text('reviewed_by').references(() => users.id),
  reviewed_at: integer('reviewed_at', { mode: 'timestamp_ms' }),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
});

// ─── Duplicate detection ──────────────────────────────────────────────────────

export const duplicate_groups = sqliteTable('duplicate_groups', {
  id: text('id').primaryKey(),
  status: text('status', { enum: ['pending', 'merged', 'kept_separate'] }).notNull().default('pending'),
  reviewed_by: text('reviewed_by').references(() => users.id),
  reviewed_at: integer('reviewed_at', { mode: 'timestamp_ms' }),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
});

export const duplicate_group_sources = sqliteTable('duplicate_group_sources', {
  group_id: text('group_id').notNull().references(() => duplicate_groups.id, { onDelete: 'cascade' }),
  source_id: text('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.group_id, t.source_id] }),
]);

// ─── Library roots ────────────────────────────────────────────────────────────

export const library_roots = sqliteTable('library_roots', {
  id: text('id').primaryKey(),
  path: text('path').notNull().unique(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  last_scan_at: integer('last_scan_at', { mode: 'timestamp_ms' }),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
});

export const scan_jobs = sqliteTable('scan_jobs', {
  id: text('id').primaryKey(),
  library_root_id: text('library_root_id').references(() => library_roots.id, { onDelete: 'set null' }),
  status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull().default('running'),
  total_files: integer('total_files').notNull().default(0),
  processed_files: integer('processed_files').notNull().default(0),
  added: integer('added').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  removed: integer('removed').notNull().default(0),
  error: text('error'),
  started_at: integer('started_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
  finished_at: integer('finished_at', { mode: 'timestamp_ms' }),
});

// ─── MusicBrainz cache ────────────────────────────────────────────────────────

export const mb_cache = sqliteTable('mb_cache', {
  key: text('key').primaryKey(),
  data: text('data', { mode: 'json' }).notNull(),
  fetched_at: integer('fetched_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
});

// ─── Playlists ────────────────────────────────────────────────────────────────

export const playlists = sqliteTable('playlists', {
  id: text('id').primaryKey(),
  owner_user_id: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  is_public: integer('is_public', { mode: 'boolean' }).notNull().default(false),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
  deleted_at: integer('deleted_at', { mode: 'timestamp_ms' }),
}, (t) => [
  index('idx_playlists_owner').on(t.owner_user_id),
]);

export const playlist_tracks = sqliteTable('playlist_tracks', {
  playlist_id: text('playlist_id').notNull().references(() => playlists.id, { onDelete: 'cascade' }),
  track_id: text('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  added_at: integer('added_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
}, (t) => [
  primaryKey({ columns: [t.playlist_id, t.position] }),
]);

// ─── Favorites ────────────────────────────────────────────────────────────────

export const favorites = sqliteTable('favorites', {
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  track_id: text('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
}, (t) => [
  primaryKey({ columns: [t.user_id, t.track_id] }),
]);

// ─── Play history ─────────────────────────────────────────────────────────────

export const play_history = sqliteTable('play_history', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  track_id: text('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  source_id: text('source_id').references(() => sources.id, { onDelete: 'set null' }),
  played_at: integer('played_at', { mode: 'timestamp_ms' }).notNull(),
  played_duration: integer('played_duration').notNull().default(0),
}, (t) => [
  index('idx_play_history_user').on(t.user_id),
  index('idx_play_history_track').on(t.track_id),
  index('idx_play_history_played_at').on(t.played_at),
]);

// ─── Stream sessions (internal tracking only) ─────────────────────────────────

export const stream_sessions = sqliteTable('stream_sessions', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  track_id: text('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  source_id: text('source_id').references(() => sources.id, { onDelete: 'set null' }),
  media_kind: text('media_kind', { enum: ['audio', 'video'] }).notNull(),
  format: text('format'),
  bitrate: integer('bitrate'),
  bytes_sent: integer('bytes_sent').notNull().default(0),
  started_at: integer('started_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
  ended_at: integer('ended_at', { mode: 'timestamp_ms' }),
}, (t) => [
  index('idx_stream_sessions_user').on(t.user_id),
  index('idx_stream_sessions_started_at').on(t.started_at),
]);

// ─── Artist aliases ───────────────────────────────────────────────────────────

export const artist_aliases = sqliteTable('artist_aliases', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  alias: text('alias').notNull(),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now') * 1000)`),
}, (t) => [
  uniqueIndex('idx_artist_aliases_pair').on(t.name, t.alias),
]);

// ─── FTS5 virtual tables (raw SQL in migration) ────────────────────────────────
// Defined as raw SQL in the initial migration, not as Drizzle table objects.
// tracks_fts: content='tracks', content_rowid='rowid' (title)
// artists_fts: content='artists', content_rowid='rowid' (name)
// albums_fts: content='albums', content_rowid='rowid' (title)
