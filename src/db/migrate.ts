import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as fs from 'fs';

const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'podo.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('cache_size = -64000');

const db = drizzle(sqlite);
migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });

console.log('Migrations applied.');
sqlite.close();
