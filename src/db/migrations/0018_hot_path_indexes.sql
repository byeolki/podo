-- Indexes for the columns the hot paths filter on but nothing indexed.
--
-- Measured on 3000 tracks / 20000 favourites / a 2000-track playlist:
--   favourites by track_id (runs twice on every list render)  0.254ms -> 0.028ms
--   playlists containing a track                              0.039ms -> 0.001ms
--   live tracks, newest first                                 0.101ms -> 0.013ms
CREATE INDEX IF NOT EXISTS idx_favorites_track ON favorites(track_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks(track_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tracks_added_at ON tracks(added_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tracks_deleted_at ON tracks(deleted_at);--> statement-breakpoint
-- Auto-sync asks "have I already downloaded this URL?" once per remote entry.
CREATE INDEX IF NOT EXISTS idx_sources_source_url ON sources(source_url);--> statement-breakpoint

-- A playlist's primary key is (playlist_id, position), so `ON CONFLICT DO
-- NOTHING` on an insert never fired for a track already in the list — it only
-- ever guarded against reusing a position. Adding the same track twice appended
-- it twice, silently, which is exactly what the assistant does when asked to
-- extend a playlist it has already filled.
--
-- Existing duplicates have to go before the constraint can exist; the earliest
-- position wins, since that is where the track was first put.
DELETE FROM playlist_tracks
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM playlist_tracks GROUP BY playlist_id, track_id
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_tracks_unique ON playlist_tracks(playlist_id, track_id);
