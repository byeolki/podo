CREATE TABLE `playlist_radio_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`playlist_id` text NOT NULL,
	`token` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`last_played_at` integer,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playlist_radio_tokens_token_unique` ON `playlist_radio_tokens` (`token`);
--> statement-breakpoint
CREATE INDEX `idx_playlist_radio_tokens_playlist` ON `playlist_radio_tokens` (`playlist_id`);
