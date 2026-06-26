import { Controller, Get, Query, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { gt, or, and, isNull } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';

@ApiTags('sync')
@ApiBearerAuth()
@Controller('api/v1/sync')
export class SyncController {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  @Get()
  @ApiOperation({ summary: 'Delta sync — get changes since cursor (timestamp ms)' })
  @ApiQuery({ name: 'since', required: false, type: Number })
  async sync(@Query('since') since?: string) {
    const cursor = since ? new Date(parseInt(since, 10)) : new Date(0);

    const [tracks, sources, artists, albums] = await Promise.all([
      this.db
        .select()
        .from(schema.tracks)
        .where(gt(schema.tracks.updated_at, cursor)),
      this.db
        .select()
        .from(schema.sources)
        .where(gt(schema.sources.updated_at, cursor)),
      this.db
        .select()
        .from(schema.artists)
        .where(gt(schema.artists.updated_at, cursor)),
      this.db
        .select()
        .from(schema.albums)
        .where(gt(schema.albums.updated_at, cursor)),
    ]);

    const nextCursor = Date.now();

    return {
      cursor: nextCursor,
      tracks: {
        upserted: tracks.filter((t) => !t.deleted_at),
        removed: tracks.filter((t) => t.deleted_at).map((t) => t.id),
      },
      sources: {
        upserted: sources.filter((s) => !s.deleted_at),
        removed: sources.filter((s) => s.deleted_at).map((s) => s.id),
      },
      artists: { upserted: artists },
      albums: { upserted: albums },
    };
  }
}
