ALTER TABLE tracks ADD COLUMN artist TEXT;
--> statement-breakpoint
UPDATE tracks SET artist = (
  SELECT a.name FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
  WHERE ta.track_id = tracks.id ORDER BY ta.position LIMIT 1
);
--> statement-breakpoint
DROP TRIGGER IF EXISTS artists_fts_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS artists_fts_delete;
--> statement-breakpoint
DROP TRIGGER IF EXISTS artists_fts_update;
--> statement-breakpoint
DROP TABLE IF EXISTS artists_fts;
--> statement-breakpoint
DROP TABLE IF EXISTS track_artists;
--> statement-breakpoint
DROP TABLE IF EXISTS artists;
