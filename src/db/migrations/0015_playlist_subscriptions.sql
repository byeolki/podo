CREATE TABLE `playlist_subscriptions` (
	`playlist_id` text PRIMARY KEY NOT NULL,
	`source_url` text NOT NULL,
	`provider` text NOT NULL DEFAULT 'other',
	`audio_only` integer DEFAULT true NOT NULL,
	`interval_minutes` integer DEFAULT 360 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_synced_at` integer,
	`last_status` text,
	`last_error` text,
	`added_count` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_playlist_subscriptions_enabled` ON `playlist_subscriptions` (`enabled`);
