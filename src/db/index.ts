import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import * as path from 'path';
import * as fs from 'fs';

export type Db = BetterSQLite3Database<typeof schema>;

let _db: Db | null = null;
let _sqlite: Database.Database | null = null;

export function createDatabase(dbPath?: string): { db: Db; sqlite: Database.Database } {
  const resolvedPath = dbPath ?? process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'podo.db');
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const sqlite = new Database(resolvedPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('cache_size = -64000');
  sqlite.pragma('temp_store = MEMORY');

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export function getDb(): Db {
  if (!_db) throw new Error('Database not initialized');
  return _db;
}

export function initDatabase(dbPath?: string): Db {
  const { db, sqlite } = createDatabase(dbPath);
  _db = db;
  _sqlite = sqlite;
  return db;
}

export function closeDatabaseConnection(): void {
  _sqlite?.close();
  _db = null;
  _sqlite = null;
}

export * from './schema';
