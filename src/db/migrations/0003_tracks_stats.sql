ALTER TABLE `tracks` ADD `play_count` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `tracks` ADD `added_by` text REFERENCES users(id);
