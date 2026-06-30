CREATE TABLE `artist_aliases` (
  `id` text PRIMARY KEY,
  `name` text NOT NULL,
  `alias` text NOT NULL,
  `created_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000)
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artist_aliases_pair` ON `artist_aliases` (`name`, `alias`);
