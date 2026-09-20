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
import { BroadcastService } from '../dist/broadcast/broadcast.service.js';
import { ScannerService } from '../dist/library/scanner.service.js';
import { SearchService } from '../dist/search/search.service.js';
import { UploadService } from '../dist/upload/upload.service.js';
import { AiChatService, trimToolLog } from '../dist/ai/ai-chat.service.js';
import { ArtistsService, encodeArtistId } from '../dist/artists/artists.service.js';

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

await group('A radio stream does not skip video-backed tracks', async () => {
  const { db, cfg } = fresh();
  const dir = fs.mkdtempSync('/tmp/podo-reg-b-');
  fs.writeFileSync(`${dir}/cover.mp4`, 'x');
  await db.insert(schema.sources).values({
    id: 'sb', track_id: 't1', media_kind: 'video', origin: 'local',
    locator: `${dir}/cover.mp4`, available: true,
  });
  const broadcast = new BroadcastService(db, cfg, {});
  const source = await broadcast.resolveAudioSource('t1');
  ok('a video-only track resolves for broadcast', source?.id === 'sb');
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

await group('Subtitles become synced lyrics', async () => {
  const { s: raw, db } = fresh();
  const dir = fs.mkdtempSync('/tmp/podo-reg-l-');
  fs.writeFileSync(`${dir}/song.m4a`, 'x');
  fs.writeFileSync(`${dir}/song.ko.vtt`,
    'WEBVTT\n\n1\n00:00:12.500 --> 00:00:15.000\n어둠이 내려앉은 이 거리\n\n2\n00:01:05.000 --> 00:01:08.000\n<i>Everybody</i> watch your back\n');
  fs.writeFileSync(`${dir}/song.en.vtt`, 'WEBVTT\n\n1\n00:00:12.500 --> 00:00:15.000\nOn this darkened street\n');
  const scanner = new ScannerService(db, {}, {}, {}, { get: (_k, d) => d });
  await scanner.maybeSetLyrics('t1', `${dir}/song.m4a`, 'ytdlp');
  const rows = raw.prepare('SELECT language, content FROM lyrics WHERE track_id=? ORDER BY language').all('t1');
  ok('every subtitle language is kept', rows.length === 2, `${rows.length} stored`);
  const ko = rows.find((r) => r.language === 'ko');
  ok('cue times become LRC stamps', ko?.content.startsWith('[00:12.50]'), ko?.content.slice(0, 20));
  ok('markup is stripped from the line', ko?.content.includes('Everybody watch your back'));
  ok('the subtitle files are cleaned up', fs.readdirSync(dir).filter((f) => f.endsWith('.vtt')).length === 0);
  // A scan that is not from a download must not go looking for subtitles.
  fs.writeFileSync(`${dir}/song.ko.vtt`, 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nlocal\n');
  await scanner.maybeSetLyrics('t1', `${dir}/song.m4a`, 'local');
  ok('a local scan leaves subtitles alone', fs.existsSync(`${dir}/song.ko.vtt`));
  fs.rmSync(dir, { recursive: true, force: true });
});

await group('A renamed track is findable by the names it was given', async () => {
  const { s: raw } = fresh();
  raw.exec(`UPDATE track_metadata_overrides SET alternate_titles = 'Growl, Eureureong' WHERE track_id='t1'`);
  const search = new SearchService(raw, { get: (_k, d) => d });
  const q = (t) => search.searchTracksSimple(t, 10).map((h) => h.id);
  ok('found by an alternate name', q('Growl').includes('t1'));
  ok('found by a romanisation', q('Eureureong').includes('t1'));
  ok('found by the original artist', q('시인과 촌장').includes('t1'));
  ok('a deleted track is never returned', q('Gone').length === 0);
});

await group('A file too large for the proxy still gets through', async () => {
  const { db, cfg } = fresh();
  const dir = fs.mkdtempSync('/tmp/podo-reg-c-');
  const cfg2 = { get: (k, d) => ({ upload_dir: dir })[k] ?? d };
  const upload = new UploadService(cfg2, { scanFile: async () => {} }, db);
  const begun = upload.beginChunked('big cover.mp4');
  ok('the part size stays well under a 100MB proxy limit', begun.chunk_size <= 16 * 1024 * 1024,
     `${begun.chunk_size} bytes`);
  const piece = Buffer.alloc(1024, 3);
  for (let i = 0; i < 5; i++) {
    const { Readable } = await import('node:stream');
    await upload.appendChunk(begun.upload_id, Readable.from(piece));
  }
  const done = await upload.finishChunked(begun.upload_id);
  ok('the parts reassemble to the whole file', fs.statSync(done.path).size === 5 * 1024);
  ok('nothing is left in the upload directory but the file',
     fs.readdirSync(dir).filter((f) => f.endsWith('.part')).length === 0);
  let refused = false;
  try { await upload.finishChunked(begun.upload_id); } catch { refused = true; }
  ok('finishing twice is refused', refused);
  ok('an unusable extension is refused before anything is sent', (() => {
    try { upload.beginChunked('notes.txt'); return false; } catch { return true; }
  })());
  fs.rmSync(dir, { recursive: true, force: true });
});

await group('A slow model does not throw away the tool steps that worked', async () => {
  // Three tools ran, the fourth call timed out, and the panel answered "check
  // Settings → AI" — sending someone to a page that was fine and discarding
  // everything the turn had already found.
  const asked = [];
  const replies = [
    { tool: 'list_playlists', args: {} },
    { tool: 'get_playlist', args: { playlist_id: 'p1' } },
    { tool: 'list_tracks', args: {} },
    null,                                   // the call that times out
    { reply: 'I got as far as reading the playlist.' },
  ];
  const ai = {
    isChatEnabled: async () => true,
    lastFailure: () => 'claude-code (claude-sonnet-5): timed out after 60000ms',
    askJson: async (_system, _user, timeoutMs) => { asked.push(timeoutMs); return replies.shift() ?? null; },
  };
  const chat = new AiChatService(ai, {}, { findAllForUser: async () => [] }, {}, {});
  const out = await chat.chat([{ role: 'user', content: 'hi' }], 'u1');
  ok('the work already done is summarised', out.reply === 'I got as far as reading the playlist.');
  ok('the tools that ran are still reported', out.used_tools.length === 3);
  // Tool steps get the budget minus the reserve; the closing summary is allowed
  // the reserve too. Neither may be unbounded — an unbounded step is how a turn
  // reached 97s and died at the proxy instead of answering.
  ok('every tool step is bounded by what is left of the turn',
     asked.slice(0, -1).every((t) => typeof t === 'number' && t > 0 && t <= 55_000), JSON.stringify(asked));
  ok('the closing summary is bounded too',
     typeof asked.at(-1) === 'number' && asked.at(-1) > 0 && asked.at(-1) <= 75_000, String(asked.at(-1)));

  // With nothing found yet, the reason has to be the real one.
  const bare = new AiChatService(
    { isChatEnabled: async () => true, lastFailure: () => 'claude-code: timed out after 60000ms', askJson: async () => null },
    {}, {}, {}, {},
  );
  const first = await bare.chat([{ role: 'user', content: 'hi' }], 'u1');
  ok('a timeout is not reported as a misconfiguration', !/Settings/.test(first.reply), first.reply);
});

await group('The prompt does not grow until the provider gives up', async () => {
  const entry = (name) => `\n${name}(${JSON.stringify({})}) -> <<<DATA\n${JSON.stringify({ rows: 'x'.repeat(9000) })}\nDATA>>>`;
  const log = entry('search_tracks') + entry('list_tracks') + entry('get_playlist') + entry('get_favorites');
  const trimmed = trimToolLog(log);
  ok('the log is bounded', trimmed.length < log.length && trimmed.length <= 26_000, `${trimmed.length}`);
  ok('the newest result survives', trimmed.includes('get_favorites('));
  ok('the oldest is what goes', !trimmed.includes('search_tracks('));
  ok('the drop is stated rather than silent', /earlier tool result/.test(trimmed));
  const fences = (trimmed.match(/<<<DATA/g) ?? []).length === (trimmed.match(/DATA>>>/g) ?? []).length;
  ok('no half-open data fence is left behind', fences);
  ok('a short log is untouched', trimToolLog('\nsearch_tracks({}) -> <<<DATA\n[]\nDATA>>>').startsWith('\nsearch_tracks'));
});

await group('A shared credit is several artists, not one entry', async () => {
  // Every credit in this library names a group of people ("송밤, 키마, 콧시,
  // 윤단"). Listing credit strings would have shown one unclickable entry per
  // combination and none per person.
  const { s, db, cfg } = fresh();
  s.exec(`
    INSERT INTO tracks (id,title,artist,is_cover) VALUES
      ('a1','Two','송밤, 윤단',1),('a2','Four','송밤, 키마, 콧시, 윤단',1),
      ('a3','Wide','ＳＯＮＧ  밤',0),('a4','Same','song 밤',0),('a5','Dead','송밤',0);
    UPDATE tracks SET deleted_at = 1 WHERE id='a5';
    INSERT INTO track_metadata_overrides (track_id,artist,updated_by) VALUES ('a2','송밤, 윤단','u1');
  `);
  const tracks = new TracksService(db, {}, cfg);
  const artists = new ArtistsService(db, tracks);
  const all = await artists.findAll();
  const by = (n) => all.find((a) => a.name === n);

  ok('each person is their own entry', !!by('송밤') && !!by('윤단'), all.map((a) => a.name).join(' | '));
  ok('the credit string itself is never an entry', !all.some((a) => a.name.includes(',')));
  ok('an override replaces the stored credit, it does not add to it',
     by('키마') === undefined && by('콧시') === undefined, all.map((a) => a.name).join(' | '));
  // a3 is 'ＳＯＮＧ  밤' and a4 is 'song 밤': full-width, double-spaced and cased
  // differently, one artist.
  const merged = all.filter((a) => ['ＳＯＮＧ  밤', 'song 밤'].includes(a.name));
  ok('width, spacing and case are the same artist',
     merged.length === 1 && merged[0].track_count === 2, JSON.stringify(merged));
  // a1 and a2 credit 송밤; a5 does too but is deleted.
  ok('a deleted track is not counted', by('송밤').track_count === 2, JSON.stringify(by('송밤')));
  ok('the original artist of a cover gets an entry too', !!by('시인과 촌장'));
  ok('someone only ever covered has no performed tracks',
     by('시인과 촌장').track_count === 0 && by('시인과 촌장').original_count === 1);
  ok('the busiest artist sorts first', all[0].track_count >= all[all.length - 1].track_count);

  const detail = await artists.findOne(by('윤단').id, 'u1');
  ok('the page lists every track they are credited on', detail.tracks.length === 3,
     detail.tracks.map((t) => t.id).join(','));
  ok('their own songs covered by others are a separate list', detail.original_tracks.length === 0);

  const origin = await artists.findOne(by('시인과 촌장').id, 'u1');
  ok('a covered artist still has a page', origin.tracks.length === 0 && origin.original_tracks.length === 1);

  ok('an id survives a name with a slash in it',
     encodeArtistId('AC/DC') === encodeArtistId('ac/dc') && !encodeArtistId('AC/DC').includes('/'));
  let missing = false;
  try { await artists.findOne(encodeArtistId('nobody at all'), 'u1'); } catch { missing = true; }
  ok('an unknown artist is a 404, not an empty page', missing);
});

console.log(failures === 0 ? '\nAll regression cases hold.' : `\n${failures} regression(s) BROKEN.`);
process.exitCode = failures === 0 ? 0 : 1;
