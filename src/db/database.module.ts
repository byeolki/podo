import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import * as schema from './schema';
import * as path from 'path';
import * as fs from 'fs';

export const DB_TOKEN = 'DRIZZLE_DB';
export const SQLITE_TOKEN = 'SQLITE_INSTANCE';

export type Db = BetterSQLite3Database<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: SQLITE_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbPath = config.get<string>('DB_PATH', path.join(process.cwd(), 'data', 'podo.db'));
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });

        const sqlite = new Database(dbPath);
        sqlite.pragma('journal_mode = WAL');
        sqlite.pragma('foreign_keys = ON');
        sqlite.pragma('synchronous = NORMAL');
        sqlite.pragma('cache_size = -64000');
        sqlite.pragma('temp_store = MEMORY');
        return sqlite;
      },
    },
    {
      provide: DB_TOKEN,
      inject: [SQLITE_TOKEN, ConfigService],
      useFactory: (sqlite: Database.Database, config: ConfigService) => {
        const db = drizzle(sqlite, { schema });
        const migrationsFolder = config.get<string>(
          'MIGRATIONS_PATH',
          path.join(__dirname, 'migrations'),
        );
        migrate(db, { migrationsFolder });
        return db;
      },
    },
  ],
  exports: [DB_TOKEN, SQLITE_TOKEN],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor() {}

  onApplicationShutdown() {}
}
