#!/usr/bin/env node
/**
 * podo — a command line client for a Podo server.
 *
 * Exists for the one thing a browser is bad at: putting a lot of large files in.
 * A drag-and-drop upload buffers, can't be resumed, gives up on a flaky
 * connection, and has to be watched. This streams each file straight off disk,
 * skips what the server already has, retries, and can be left alone.
 *
 * No dependencies on purpose — it runs from a checkout with `node cli/podo.mjs`
 * or installed globally, and a tool for moving files shouldn't drag an install
 * tree along with it.
 */

import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { Readable } from 'node:stream'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'podo')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

/** Mirrors the server's allowlist; checked here to skip the round trip. */
const MEDIA_EXTS = new Set([
  '.mp3', '.m4a', '.flac', '.aac', '.wav', '.ogg', '.opus', '.mp4', '.m4v', '.mkv',
])

const DEFAULT_CONCURRENCY = 2
const MAX_ATTEMPTS = 3

// ─── config ──────────────────────────────────────────────────────────────────

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true })
  // Tokens live here, so keep it to the owner.
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
}

function requireAuth() {
  const config = loadConfig()
  if (!config.server || !config.refresh_token) {
    fail('Not logged in. Run:  podo login https://music.example.com')
  }
  return config
}

// ─── http ────────────────────────────────────────────────────────────────────

/**
 * Access tokens are short-lived, and an upload run can outlive one easily, so
 * every call refreshes and retries once on a 401 rather than dying halfway
 * through a directory.
 */
async function api(config, path, { method = 'GET', body, headers = {}, raw } = {}) {
  const send = async (token) => {
    const response = await fetch(`${config.server}/api/v1${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(raw ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      ...(raw ? { duplex: 'half' } : {}),
    })
    return response
  }

  let response = await send(config.access_token)
  if (response.status === 401 && config.refresh_token && !raw) {
    await refresh(config)
    response = await send(config.access_token)
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`)
  }
  return response.status === 204 ? null : response.json()
}

/** Seconds left on the current access token, or 0 when there isn't one. */
function tokenLifeLeft(token) {
  if (!token) return 0
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    return (payload.exp ?? 0) - Math.floor(Date.now() / 1000)
  } catch {
    return 0
  }
}

async function refresh(config) {
  const response = await fetch(`${config.server}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: config.refresh_token }),
  })
  if (response.status === 429) {
    // The auth endpoints are rate limited far more tightly than the rest of the
    // API. Saying "session expired" here sent people to re-login when waiting
    // was the answer.
    fail('Rate limited by the server on sign-in. Wait a minute and try again.')
  }
  if (!response.ok) fail(`Session expired (${response.status}). Run \`podo login\` again.`)
  const tokens = await response.json()
  config.access_token = tokens.access_token
  if (tokens.refresh_token) config.refresh_token = tokens.refresh_token
  saveConfig(config)
}

/**
 * Refreshes only when the token is close to running out.
 *
 * Doing it per file looks harmless and is not: `/auth/refresh` shares the strict
 * credential rate limit, so a directory of more than a handful of files locked
 * itself out partway through.
 */
async function ensureFreshToken(config, minSeconds = 120) {
  if (tokenLifeLeft(config.access_token) < minSeconds) await refresh(config)
}

// ─── upload ──────────────────────────────────────────────────────────────────

/**
 * Streams one file as multipart/form-data.
 *
 * Built by hand rather than with FormData because FormData reads the file into
 * memory to compute its length — which is exactly what this command exists to
 * avoid. The body is an async generator, so a 2GB file costs one buffer at a
 * time.
 */
async function uploadFile(config, filePath, onProgress) {
  const boundary = `----podo${randomUUID()}`
  const filename = basename(filePath)
  const total = statSync(filePath).size
  let sent = 0

  async function* body() {
    yield Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename.replace(/"/g, '')}"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n',
    )
    for await (const chunk of createReadStream(filePath, { highWaterMark: 1 << 20 })) {
      sent += chunk.length
      onProgress?.(sent, total)
      yield chunk
    }
    yield Buffer.from(`\r\n--${boundary}--\r\n`)
  }

  // A 401 mid-stream can't be retried — the file has already been read — so the
  // token is renewed up front, but only when it is actually close to expiring.
  await ensureFreshToken(config)

  const result = await api(config, '/upload', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    raw: Readable.toWeb(Readable.from(body())),
  })

  const entry = result?.uploaded?.[0]
  if (entry?.error) throw new Error(entry.error)
  return entry
}

/**
 * The name a file will be known by on the server.
 *
 * Uploads are stored with a timestamp prefix (`1789223942895_Song.flac`) so two
 * files of the same name can coexist. Comparing raw basenames therefore never
 * matched anything and every re-run uploaded the whole directory again.
 */
function storedName(name) {
  return name.replace(/^\d{10,}_/, '')
}

async function collectFiles(paths) {
  const files = []
  for (const path of paths) {
    const full = resolve(path)
    if (!existsSync(full)) {
      warn(`skipping ${path} — no such file`)
      continue
    }
    if (statSync(full).isDirectory()) {
      for (const entry of await readdir(full, { withFileTypes: true, recursive: true })) {
        if (!entry.isFile()) continue
        const child = join(entry.parentPath ?? entry.path ?? full, entry.name)
        if (MEDIA_EXTS.has(extname(child).toLowerCase())) files.push(child)
      }
    } else if (MEDIA_EXTS.has(extname(full).toLowerCase())) {
      files.push(full)
    } else {
      warn(`skipping ${basename(full)} — not a media file`)
    }
  }
  return files.sort()
}

async function cmdUpload(args) {
  const config = requireAuth()
  const concurrency = Number(flag(args, '--jobs') ?? DEFAULT_CONCURRENCY)
  const force = args.includes('--force')
  // Drop both the flags and the values they take, or `--jobs 1` leaves a stray
  // "1" that gets treated as a path to upload.
  const paths = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--jobs')
  if (!paths.length) fail('Usage: podo upload <file-or-directory>... [--jobs N] [--force]')

  const files = await collectFiles(paths)
  if (!files.length) fail('Nothing to upload.')

  // Re-uploading what the server already has is the most likely way to waste a
  // long run, so ask once and skip by name.
  let existing = new Set()
  if (!force) {
    try {
      const rows = await api(config, '/upload/files')
      existing = new Set((rows ?? []).map((f) => storedName(f.filename ?? basename(f.path ?? ''))).filter(Boolean))
    } catch {
      warn("couldn't read what's already uploaded — continuing without skipping")
    }
  }

  const queue = files.filter((f) => !existing.has(basename(f)))
  const skipped = files.length - queue.length
  console.log(
    `${queue.length} file${queue.length === 1 ? '' : 's'} to upload` +
    (skipped ? ` (${skipped} already there)` : '') +
    `, ${concurrency} at a time\n`,
  )

  let done = 0
  let failed = 0
  const started = Date.now()

  const worker = async () => {
    for (;;) {
      const filePath = queue.shift()
      if (!filePath) return
      const label = basename(filePath)
      const size = statSync(filePath).size

      let lastError
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          await uploadFile(config, filePath, (sent, total) => {
            if (concurrency === 1) progress(label, sent, total)
          })
          done++
          line(`  ✓ ${label} (${human(size)})`)
          lastError = null
          break
        } catch (e) {
          lastError = e
          if (attempt < MAX_ATTEMPTS) {
            await sleep(1000 * attempt)
          }
        }
      }
      if (lastError) {
        failed++
        line(`  ✗ ${label} — ${lastError.message}`)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))

  const seconds = Math.round((Date.now() - started) / 1000)
  console.log(`\n${done} uploaded, ${failed} failed, in ${seconds}s`)
  // Nothing to run afterwards: the upload endpoint scans each file as it lands,
  // so the tracks exist by the time this prints. (`podo scan` is for files put
  // under a library root by other means.)
  if (done) console.log('They are in the library now.')
  if (failed) process.exitCode = 1
}

// ─── other commands ──────────────────────────────────────────────────────────

async function cmdLogin(args) {
  const server = (args[0] ?? '').replace(/\/+$/, '')
  if (!server.startsWith('http')) fail('Usage: podo login https://music.example.com')

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const email = await rl.question('Email: ')
  // No TTY masking here: hiding it would need raw mode, and getting that wrong
  // leaves the terminal broken. Use PODO_PASSWORD to keep it off the screen.
  const password = process.env.PODO_PASSWORD ?? (await rl.question('Password: '))
  rl.close()

  const response = await fetch(`${server}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) fail(`Login failed (${response.status})`)
  const tokens = await response.json()

  saveConfig({ server, access_token: tokens.access_token, refresh_token: tokens.refresh_token })
  console.log(`Logged in to ${server}`)
}

async function cmdScan() {
  const config = requireAuth()
  const roots = await api(config, '/library/roots')
  if (!roots?.length) fail('No library roots configured.')
  for (const root of roots) {
    await api(config, `/library/roots/${root.id}/scan`, { method: 'POST' })
    console.log(`Scanning ${root.path}`)
  }
}

async function cmdStatus() {
  const config = requireAuth()
  const me = await api(config, '/auth/me')
  const tracks = await api(config, '/tracks?limit=1')
  console.log(`${config.server}`)
  console.log(`  signed in as ${me.email} (${me.role})`)
  console.log(`  ${Array.isArray(tracks) ? 'reachable' : 'reachable'}`)
}

// ─── plumbing ────────────────────────────────────────────────────────────────

const flag = (args, name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const human = (bytes) => {
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`
}
const isTty = process.stdout.isTTY
function progress(label, sent, total) {
  if (!isTty) return
  const pct = total ? Math.round((sent / total) * 100) : 0
  process.stdout.write(`\r  ↑ ${label} ${pct}% (${human(sent)}/${human(total)})   `)
}
function line(text) {
  if (isTty) process.stdout.write('\r\x1b[K')
  console.log(text)
}
const warn = (text) => console.error(`  ! ${text}`)
function fail(message) {
  console.error(message)
  process.exit(1)
}

const USAGE = `podo — command line client for a Podo server

  podo login <server-url>        Sign in and remember the session
  podo upload <path>... [opts]   Upload files or whole directories
  podo scan                      Rescan every library root
  podo status                    Who and where you're signed in as

Upload options:
  --jobs N     Files in flight at once (default ${DEFAULT_CONCURRENCY}); use 1 for a progress bar
  --force      Upload even files whose name is already on the server

Config lives in ${CONFIG_PATH}. Set PODO_PASSWORD to log in without a prompt.`

const [command, ...rest] = process.argv.slice(2)
const commands = { login: cmdLogin, upload: cmdUpload, scan: cmdScan, status: cmdStatus }

if (!command || command === '--help' || command === '-h' || !commands[command]) {
  console.log(USAGE)
  process.exit(command && !commands[command] ? 1 : 0)
}

commands[command](rest).catch((e) => fail(e.message))
