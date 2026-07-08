DROP TABLE IF EXISTS `lyrics`;--> statement-breakpoint
CREATE TABLE `lyrics` (
	`track_id` text NOT NULL,
	`language` text DEFAULT 'und' NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`source` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	PRIMARY KEY(`track_id`, `language`),
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
