CREATE TABLE `album_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`album_id` text NOT NULL,
	`version_type` text DEFAULT 'regular' NOT NULL,
	`release_year` integer,
	`artwork_path` text,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_album_versions_album` ON `album_versions` (`album_id`);--> statement-breakpoint
CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`primary_artist_id` text,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`primary_artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_albums_primary_artist` ON `albums` (`primary_artist_id`);--> statement-breakpoint
CREATE TABLE `artists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_custom` integer DEFAULT false NOT NULL,
	`external_ids` text DEFAULT '{}' NOT NULL,
	`created_by` text,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_artists_name` ON `artists` (`name`);--> statement-breakpoint
CREATE TABLE `cover_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`cover_track_id` text NOT NULL,
	`original_track_id` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`cover_track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`original_track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cover_mappings_unique` ON `cover_mappings` (`cover_track_id`,`original_track_id`);--> statement-breakpoint
CREATE TABLE `duplicate_group_sources` (
	`group_id` text NOT NULL,
	`source_id` text NOT NULL,
	PRIMARY KEY(`group_id`, `source_id`),
	FOREIGN KEY (`group_id`) REFERENCES `duplicate_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `duplicate_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `favorites` (
	`user_id` text NOT NULL,
	`track_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `track_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invite_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`created_by` text NOT NULL,
	`used_by` text,
	`used_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`used_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `library_roots` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_scan_at` integer,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_roots_path_unique` ON `library_roots` (`path`);--> statement-breakpoint
CREATE TABLE `lyrics` (
	`track_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`source` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `mapping_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`audio_source_id` text,
	`video_source_id` text,
	`confidence` real NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`audio_source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`video_source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `mb_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `play_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`track_id` text NOT NULL,
	`source_id` text,
	`played_at` integer NOT NULL,
	`played_duration` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_play_history_user` ON `play_history` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_play_history_track` ON `play_history` (`track_id`);--> statement-breakpoint
CREATE INDEX `idx_play_history_played_at` ON `play_history` (`played_at`);--> statement-breakpoint
CREATE TABLE `playlist_tracks` (
	`playlist_id` text NOT NULL,
	`track_id` text NOT NULL,
	`position` integer NOT NULL,
	`added_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	PRIMARY KEY(`playlist_id`, `position`),
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_playlists_owner` ON `playlists` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_tokens_token_hash_unique` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `scan_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`library_root_id` text,
	`status` text DEFAULT 'running' NOT NULL,
	`total_files` integer DEFAULT 0 NOT NULL,
	`processed_files` integer DEFAULT 0 NOT NULL,
	`added` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`removed` integer DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`library_root_id`) REFERENCES `library_roots`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`track_id` text NOT NULL,
	`media_kind` text NOT NULL,
	`origin` text DEFAULT 'local' NOT NULL,
	`format` text,
	`codec` text,
	`bitrate` integer,
	`sample_rate` integer,
	`channels` integer,
	`duration` integer,
	`time_offset` integer DEFAULT 0 NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`locator` text NOT NULL,
	`file_hash` text,
	`file_size` integer,
	`replaygain_track` real,
	`replaygain_album` real,
	`available` integer DEFAULT true NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sources_track` ON `sources` (`track_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sources_locator` ON `sources` (`locator`);--> statement-breakpoint
CREATE INDEX `idx_sources_available` ON `sources` (`available`);--> statement-breakpoint
CREATE TABLE `stream_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`track_id` text NOT NULL,
	`source_id` text,
	`media_kind` text NOT NULL,
	`format` text,
	`bitrate` integer,
	`bytes_sent` integer DEFAULT 0 NOT NULL,
	`started_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_stream_sessions_user` ON `stream_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_stream_sessions_started_at` ON `stream_sessions` (`started_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'genre' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tags_name_kind` ON `tags` (`name`,`kind`);--> statement-breakpoint
CREATE TABLE `track_artists` (
	`track_id` text NOT NULL,
	`artist_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`role` text DEFAULT 'main' NOT NULL,
	PRIMARY KEY(`track_id`, `artist_id`),
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_track_artists_artist` ON `track_artists` (`artist_id`);--> statement-breakpoint
CREATE TABLE `track_metadata_overrides` (
	`track_id` text PRIMARY KEY NOT NULL,
	`title` text,
	`track_number` integer,
	`disc_number` integer,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `track_tags` (
	`track_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`track_id`, `tag_id`),
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`album_version_id` text,
	`track_number` integer,
	`disc_number` integer,
	`canonical_duration` integer,
	`added_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`album_version_id`) REFERENCES `album_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tracks_album_version` ON `tracks` (`album_version_id`);--> statement-breakpoint
CREATE INDEX `idx_tracks_updated_at` ON `tracks` (`updated_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
  title,
  content='tracks',
  content_rowid='rowid',
  tokenize='unicode61'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS artists_fts USING fts5(
  name,
  content='artists',
  content_rowid='rowid',
  tokenize='unicode61'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS albums_fts USING fts5(
  title,
  content='albums',
  content_rowid='rowid',
  tokenize='unicode61'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS tracks_fts_insert AFTER INSERT ON tracks BEGIN
  INSERT INTO tracks_fts(rowid, title) VALUES (new.rowid, new.title);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS tracks_fts_delete AFTER DELETE ON tracks BEGIN
  INSERT INTO tracks_fts(tracks_fts, rowid, title) VALUES ('delete', old.rowid, old.title);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS tracks_fts_update AFTER UPDATE ON tracks BEGIN
  INSERT INTO tracks_fts(tracks_fts, rowid, title) VALUES ('delete', old.rowid, old.title);
  INSERT INTO tracks_fts(rowid, title) VALUES (new.rowid, new.title);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS artists_fts_insert AFTER INSERT ON artists BEGIN
  INSERT INTO artists_fts(rowid, name) VALUES (new.rowid, new.name);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS artists_fts_delete AFTER DELETE ON artists BEGIN
  INSERT INTO artists_fts(artists_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS artists_fts_update AFTER UPDATE ON artists BEGIN
  INSERT INTO artists_fts(artists_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
  INSERT INTO artists_fts(rowid, name) VALUES (new.rowid, new.name);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS albums_fts_insert AFTER INSERT ON albums BEGIN
  INSERT INTO albums_fts(rowid, title) VALUES (new.rowid, new.title);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS albums_fts_delete AFTER DELETE ON albums BEGIN
  INSERT INTO albums_fts(albums_fts, rowid, title) VALUES ('delete', old.rowid, old.title);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS albums_fts_update AFTER UPDATE ON albums BEGIN
  INSERT INTO albums_fts(albums_fts, rowid, title) VALUES ('delete', old.rowid, old.title);
  INSERT INTO albums_fts(rowid, title) VALUES (new.rowid, new.title);
END;
