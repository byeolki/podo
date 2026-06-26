import { defineConfig } from 'drizzle-kit';
import * as path from 'path';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'podo.db'),
  },
});
