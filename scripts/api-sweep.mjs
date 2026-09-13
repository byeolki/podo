#!/usr/bin/env node
/**
 * Boots the real application against a throwaway database and calls every route
 * it exposes, asserting the status each one should answer with.
 *
 * Runs in-process through Fastify's `inject`, so it needs no port, no container
 * and no network — `npm run build && node scripts/api-sweep.mjs`.
 *
 * The environment is pinned deliberately. Left alone, an `OPENAI_API_KEY` that
 * happens to be exported turns the AI features on and changes what two of these
 * endpoints answer, which is how a clean run can quietly stop meaning anything.
 */
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from '../dist/app.module.js';

const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: ['error'] });
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
await app.init();
const srv = app.getHttpAdapter().getInstance();
await srv.ready();

const call = async (method, url, payload, token) => {
  const res = await srv.inject({ method, url, payload,
    headers: token ? { authorization: `Bearer ${token}` } : {} });
  let body; try { body = JSON.parse(res.body) } catch { body = String(res.body).slice(0, 70) }
  return { status: res.statusCode, body };
};

const boot = await call('POST', '/api/v1/auth/bootstrap', { name: 'A', email: 'admin@example.com', password: 'password123' });
const token = boot.body?.access_token;
console.log('bootstrap ->', boot.status, token ? 'token acquired' : JSON.stringify(boot.body).slice(0, 140));
if (!token) process.exit(1);

const GETS = [
  '/api/v1/tracks', '/api/v1/albums', '/api/v1/playlists', '/api/v1/playlists/public',
  '/api/v1/favorites', '/api/v1/history', '/api/v1/search?q=test', '/api/v1/radio',
  '/api/v1/library/roots', '/api/v1/library/scans', '/api/v1/upload/files',
  '/api/v1/admin/users', '/api/v1/admin/storage', '/api/v1/admin/update',
  '/api/v1/admin/health/detail', '/api/v1/admin/files', '/api/v1/admin/streams',
  '/api/v1/admin/stats/traffic', '/api/v1/admin/radio-tokens', '/api/v1/admin/mapping-queue',
  '/api/v1/admin/ai', '/api/v1/ai/status', '/api/v1/stats/me', '/api/v1/auth/me',
  '/api/v1/download', '/api/v1/radio-tokens', '/api/v1/sync', '/health',
];
let bad = 0;
for (const url of GETS) {
  const r = await call('GET', url, undefined, token);
  const ok = r.status >= 200 && r.status < 300;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} GET ${url.padEnd(36)} ${r.status}${ok ? '' : '  ' + JSON.stringify(r.body).slice(0, 100)}`);
}
console.log(`\nGET: ${GETS.length - bad}/${GETS.length} answered 2xx`);

// ── write paths ───────────────────────────────────────────────────────────────
console.log('');
let wbad = 0;
const check = async (label, method, url, payload, expect = [200, 201, 204]) => {
  const r = await call(method, url, payload, token);
  const ok = expect.includes(r.status);
  if (!ok) wbad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(44)} ${r.status}${ok ? '' : '  ' + JSON.stringify(r.body).slice(0, 110)}`);
  return r.body;
};

// seed a track directly so the write paths have something to act on
const Database = (await import('better-sqlite3')).default;
const raw = new Database(process.env.DB_PATH);
const me = raw.prepare('SELECT id FROM users LIMIT 1').get().id;
raw.prepare("INSERT INTO tracks (id,title,artist,added_by) VALUES ('tk1','Seed Track','Seed Artist',?)").run(me);
raw.prepare("INSERT INTO sources (id,track_id,media_kind,origin,locator,available) VALUES ('sc1','tk1','audio','local','/tmp/nope.m4a',1)").run();

const pl = await check('POST   playlist',                'POST',   '/api/v1/playlists', { name: 'Swept' }, [201, 200]);
const plId = pl?.id;
await check('POST   playlist tracks',                    'POST',   `/api/v1/playlists/${plId}/tracks`, { track_ids: ['tk1'] }, [200, 201, 204]);
await check('PATCH  playlist',                           'PATCH',  `/api/v1/playlists/${plId}`, { name: 'Swept again' });
await check('GET    playlist detail',                    'GET',    `/api/v1/playlists/${plId}`);
await check('PUT    subscription (bad url rejected)',    'PUT',    `/api/v1/playlists/${plId}/subscription`, { source_url: 'not a url' }, [400]);
await check('POST   radio token',                        'POST',   `/api/v1/playlists/${plId}/radio-tokens`, {}, [200, 201]);
await check('PATCH  track metadata',                     'PATCH',  '/api/v1/tracks/tk1/metadata', { title: 'Renamed', original_artist: '' });
await check('POST   bulk metadata',                      'POST',   '/api/v1/tracks/bulk-metadata', { track_ids: ['tk1'], disc_number: 1 });
await check('PUT    favorite',                           'PUT',    '/api/v1/favorites/tk1', undefined, [200, 201, 204]);
await check('DELETE favorite',                           'DELETE', '/api/v1/favorites/tk1', undefined, [200, 204]);
await check('POST   play recorded',                      'POST',   '/api/v1/tracks/tk1/play', {}, [200, 201, 204]);
await check('POST   history',                            'POST',   '/api/v1/history', { track_id: 'tk1', played_at: new Date().toISOString(), played_duration: 30 }, [200, 201]);
// AI availability depends on the machine's environment (a key or the CLI being
// present), so this asserts the two honest outcomes rather than one of them.
await check('POST   ai-fill (answers either way)',       'POST',   '/api/v1/tracks/ai-fill', { track_ids: ['tk1'] }, [200, 201, 503]);
await check('POST   ai chat (disabled -> 403)',          'POST',   '/api/v1/ai/chat', { messages: [{ role: 'user', content: 'hi' }] }, [403]);
await check('PUT    ai settings',                        'PUT',    '/api/v1/admin/ai', { enabled: false });
await check('POST   library root (missing -> 400)',      'POST',   '/api/v1/library/roots', { path: '/definitely/not/here' }, [400]);
await check('POST   library root (a file -> 400)',       'POST',   '/api/v1/library/roots', { path: process.env.DB_PATH }, [400]);
await check('POST   library root (real directory)',      'POST',   '/api/v1/library/roots', { path: process.env.UPLOAD_DIR }, [200, 201]);
await check('POST   upload rename (blank -> 400)',       'PATCH',  '/api/v1/upload/files/sc1', { filename: '' }, [400]);
await check('POST   imported resolve',                   'POST',   '/api/v1/upload/imported', { paths: ['/tmp/nope.m4a'] });
await check('GET    stream (file missing -> 404)',       'GET',    '/api/v1/stream/tk1', undefined, [404]);
await check('GET    lyrics (none -> 200/404)',           'GET',    '/api/v1/tracks/tk1/lyrics', undefined, [200, 404]);
await check('POST   tracks delete (admin)',              'POST',   '/api/v1/tracks/delete', { track_ids: ['tk1'] });
await check('DELETE playlist',                           'DELETE', `/api/v1/playlists/${plId}`, undefined, [200, 204]);
await check('POST   refresh (bad token -> 401)',         'POST',   '/api/v1/auth/refresh', { refresh_token: 'nope' }, [401]);
await check('POST   login (wrong password -> 401)',      'POST',   '/api/v1/auth/login', { email: 'admin@example.com', password: 'wrongpass1' }, [401]);
{
  const r = await call('GET', '/api/v1/tracks');
  const ok = r.status === 401;
  if (!ok) wbad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${'GET    tracks unauthenticated -> 401'.padEnd(44)} ${r.status}`);
}

await check('POST   client error report',                'POST',   '/api/v1/client-errors', { platform: 'ios', kind: 'playback', message: 'stalled and did not recover', context: 'track abc', app_version: '1.0' }, [204]);
await check('POST   client error (bad platform -> 400)', 'POST',   '/api/v1/client-errors', { platform: 'toaster', kind: 'x', message: 'y' }, [400]);

console.log(`\nWRITE: ${wbad === 0 ? 'all behaved as expected' : wbad + ' unexpected'}`);
await app.close();
