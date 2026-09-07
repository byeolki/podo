/*
 Migration 0006 dropped the `artists` table but left `albums.primary_artist_id`
 and its foreign key pointing at it. SQLite resolves foreign-key parents when it
 compiles a statement, so with `PRAGMA foreign_keys = ON` every INSERT into
 `albums` failed with "no such table: main.artists" — and since the scanner
 creates an album before the track, any file with an album tag failed to import.

 Recreating the parent table is what makes the reference resolvable again.
 Nothing writes `primary_artist_id`, and a NULL foreign key is always satisfied,
 so this table stays empty and enforces nothing.

 The tidier end state — no dead column, no dead table — would mean rebuilding
 `albums`, which SQLite only allows with foreign keys disabled for the whole
 migration run: `PRAGMA foreign_keys` is a no-op inside the transaction the
 migrator wraps each file in, and merely *deferring* enforcement isn't enough
 because `DROP TABLE albums` still fires ON DELETE CASCADE and would take
 `album_versions` (and the tracks pinned to them) with it. That is a lot of
 blast radius on a live database to remove one unused column, so the column and
 this table stay until there's a reason to rewrite the schema properly.
*/
CREATE TABLE IF NOT EXISTS `artists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
