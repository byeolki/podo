#!/usr/bin/env node
/**
 * The defects found in use, pinned so they cannot come back quietly.
 *
 * Every case here was a real bug that shipped: each one is written as the
 * question someone asked out loud ("why does the deleted field come back?")
 * rather than as a unit of code, because that is the form in which they will
 * be re-introduced.
 *
 * Plain Node, no framework — `npm run test:regression`.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as fs from 'node:fs';
import * as schema from '../dist/db/schema.js';
import { TracksService } from '../dist/tracks/tracks.service.js';
import { PlaylistsService } from '../dist/playlists/playlists.service.js';
import { HistoryService } from '../dist/history/history.service.js';
import { StreamingService } from '../dist/streaming/streaming.service.js';
import { TranscodeCacheService } from '../dist/streaming/transcode-cache.service.js';
import { titleMatches } from '../dist/musicbrainz/musicbrainz.service.js';

let failures = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`); }
};

/**
 * A group that cannot take the rest of the run down with it.
 *
 * Restoring one of these bugs to check the suite noticed made the suite *crash*
 * rather than fail, so every case after it went unrun — which would have been
 * indistinguishable from passing on a day when it mattered.
 */
const group = async (name, body) => {
  console.log(`\n${name}`);
  try { await body(); }
  catch (e) { failures++; console.log(`  FAIL ${name} threw — ${e?.message ?? e}`); }
};

const fresh = () => {
  const s = new Database(':memory:');
  migrate(drizzle(s, { schema }), { migrationsFolder: 'src/db/migrations' });
  s.exec(`
    INSERT INTO users (id,name,email,password_hash,role) VALUES ('u1','A','a@b.c','x','admin');
    INSERT INTO tracks (id,title,artist,is_cover) VALUES
      ('t1','으르렁','윤단',1),('t2','Glass Tide','Aster Vale',0),('t3','Gone','X',0);
    UPDATE tracks SET deleted_at = 1 WHERE id='t3';
    INSERT INTO track_metadata_overrides (track_id,title,artist,original_artist,is_cover,updated_by)
      VALUES ('t1','으르렁','윤단','시인과 촌장',1,'u1');
    INSERT INTO playlists (id,owner_user_id,name) VALUES ('p1','u1','P');
    INSERT INTO play_history (id,user_id,track_id,played_at,played_duration)
      VALUES ('h1','u1','t1',2,10),('h2','u1','t3',1,10);
  `);
  const db = drizzle(s, { schema });
  const cfg = { get: (_k, d) => d };
  return { s, db, cfg };
};

await group('A cleared field stays cleared', async () => {
    const { s, db, cfg } = fresh();
    const tracks = new TracksService(db, {}, cfg);
    await tracks.applyOverride('t1', { original_artist: '' }, 'u1');
    const row = s.prepare('SELECT original_artist FROM track_metadata_overrides WHERE track_id=?').get('t1');
    ok('an empty string clears the column', row.original_artist === null, JSON.stringify(row));
    await tracks.applyOverride('t1', { title: 'Kept' }, 'u1');
    const again = s.prepare('SELECT original_artist FROM track_metadata_overrides WHERE track_id=?').get('t1');
    ok('a field not mentioned is left alone', again.original_artist === null);
});

await group('Deleted tracks stay out of the lists', async () => {
    const { db } = fresh();
    const history = new HistoryService(db);
    const recent = await history.getRecent('u1');
    ok('recently played excludes a deleted track', recent.every((r) => r.track_id !== 't3'),
       recent.map((r) => r.track_id).join(','));
    const stats = await history.getStats('u1', 'all');
    ok('top tracks excludes a deleted track', stats.top_tracks.every((r) => r.track_id !== 't3'));
});

await group('A playlist cannot hold the same track twice', async () => {
    const { s, db, cfg } = fresh();
    const playlists = new PlaylistsService(db, cfg, {}, {}, {});
    await playlists.addTracks('p1', ['t1', 't2'], 'u1');
    await playlists.addTracks('p1', ['t2', 't1'], 'u1');
    const n = s.prepare('SELECT count(*) c FROM playlist_tracks WHERE playlist_id=?').get('p1').c;
    ok('adding the same tracks again adds nothing', n === 2, `${n} rows`);
});

await group('Asking for audio never 404s on a video-only track', async () => {
    const { db, cfg } = fresh();
    const dir = fs.mkdtempSync('/tmp/podo-reg-');
    fs.writeFileSync(`${dir}/cover.mp4`, 'not really a video');
    const s2 = db;
    await s2.insert(schema.sources).values({
      id: 'sv', track_id: 't1', media_kind: 'video', origin: 'local',
      locator: `${dir}/cover.mp4`, available: true, format: 'mp4', codec: 'h264',
    });
    const cacheCfg = { get: (k, d) => ({ transcode_cache_dir: `${dir}/cache`, upload_dir: dir, library_roots: [] })[k] ?? d };
    const streaming = new StreamingService(db, new TranscodeCacheService(cacheCfg), cacheCfg);
    const source = await streaming.resolveSource({ trackId: 't1', mediaKind: 'audio' });
    ok('an explicit media_kind=audio falls back to the video source', source?.media_kind === 'video');
    let threw = false;
    try { await streaming.resolveSource({ trackId: 't2', mediaKind: 'video' }); } catch { threw = true; }
    ok('an explicit media_kind=video still refuses audio-only', threw);
    fs.rmSync(dir, { recursive: true, force: true });
});

await group('A container already holding the requested codec is not re-encoded', async () => {
    const { db, cfg } = fresh();
    const streaming = new StreamingService(db, new TranscodeCacheService(cfg), cfg);
    const m4a = { format: 'm4a', codec: 'aac', bitrate: 256 };
    const flac = { format: 'flac', codec: 'flac', bitrate: 1000 };
    ok('aac asked of an m4a is a passthrough', streaming.needsTranscode(m4a, 'aac') === false);
    ok('aac asked of a flac transcodes', streaming.needsTranscode(flac, 'aac') === true);
    ok('no format asked is always a passthrough', streaming.needsTranscode(flac) === false);
});

await group('A bilingual MusicBrainz title is the same song', async () => {
    // The real function, not a copy of it — a test that reimplements what it is
    // checking passes for ever, including after the thing it guards is deleted.
    ok('"으르렁 (Growl)" matches "으르렁"', titleMatches('으르렁 (Growl)', '으르렁'));
    ok('"으르렁 (Growl)" matches "Growl"', titleMatches('으르렁 (Growl)', 'Growl'));
    ok('"Creep Creep" does not match "Creep"', !titleMatches('Creep Creep', 'Creep'));
    ok('"Creep, creep, softly creep" does not match "Creep"', !titleMatches('Creep, creep, softly creep', 'Creep'));
    ok('an exact title still matches', titleMatches('밤편지', '밤편지'));
});

console.log(failures === 0 ? '\nAll regression cases hold.' : `\n${failures} regression(s) BROKEN.`);
process.exitCode = failures === 0 ? 0 : 1;
