ALTER TABLE `tracks` ADD `is_cover` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tracks` ADD `original_artist_id` text REFERENCES `artists`(`id`);--> statement-breakpoint
ALTER TABLE `playlists` ADD `is_public` integer DEFAULT 0 NOT NULL;
