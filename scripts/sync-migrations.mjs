import { readdir, readFile, writeFile } from 'fs/promises'
import { join, basename, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations')
const JOURNAL_PATH = join(MIGRATIONS_DIR, 'meta/_journal.json')

const files = (await readdir(MIGRATIONS_DIR))
  .filter((f) => f.endsWith('.sql'))
  .sort()

const journal = JSON.parse(await readFile(JOURNAL_PATH, 'utf8'))
const existingTags = new Set(journal.entries.map((e) => e.tag))

let changed = false
for (const file of files) {
  const tag = basename(file, '.sql')
  if (!existingTags.has(tag)) {
    journal.entries.push({ idx: journal.entries.length, version: '6', when: Date.now(), tag, breakpoints: true })
    existingTags.add(tag)
    changed = true
    process.stdout.write(`migration journal: added ${tag}\n`)
  }
}

if (changed) {
  journal.entries.sort((a, b) => a.idx - b.idx)
  await writeFile(JOURNAL_PATH, JSON.stringify(journal, null, 2) + '\n')
}
