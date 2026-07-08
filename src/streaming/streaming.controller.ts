import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest, FastifyReply } from 'fastify';
import { StreamingService } from './streaming.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/guards/jwt-auth.guard';
import { Inject } from '@nestjs/common';
import { Db, DB_TOKEN } from '../db/database.module';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('streaming')
@ApiBearerAuth()
@Controller('api/v1')
export class StreamingController {
  constructor(
    private readonly streaming: StreamingService,
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly config: ConfigService,
  ) {}

  @Get('stream/:track_id')
  @ApiOperation({ summary: 'Stream a track (HTTP Range supported for passthrough; use seek_ms for transcoded)' })
  @ApiQuery({ name: 'media_kind', required: false, enum: ['audio', 'video'] })
  @ApiQuery({ name: 'source_id', required: false })
  @ApiQuery({ name: 'format', required: false, enum: ['aac', 'opus', 'mp3', 'flac'] })
  @ApiQuery({ name: 'bitrate', required: false, type: Number })
  @ApiQuery({ name: 'seek_ms', required: false, type: Number, description: 'Seek position in ms (for transcoded streams)' })
  @ApiQuery({ name: 'normalize', required: false, type: Boolean })
  async stream(
    @Param('track_id') trackId: string,
    @Query('media_kind') mediaKind?: 'audio' | 'video',
    @Query('source_id') sourceId?: string,
    @Query('format') format?: string,
    @Query('bitrate') bitrate?: string,
    @Query('seek_ms') seekMs?: string,
    @Query('normalize') normalize?: string,
    @CurrentUser() user?: JwtPayload,
    @Req() req?: FastifyRequest,
    @Res() reply?: FastifyReply,
  ) {
    await this.streaming.stream(
      {
        trackId,
        userId: user!.sub,
        userRole: user!.role,
        mediaKind,
        sourceId,
        format,
        bitrate: bitrate ? parseInt(bitrate, 10) : undefined,
        seekMs: seekMs ? parseInt(seekMs, 10) : undefined,
        normalize: normalize === '1' || normalize === 'true',
      },
      req!,
      reply!,
    );
  }

  @Public()
  @Get('artwork/:id')
  @ApiOperation({ summary: 'Get artwork image' })
  async artwork(@Param('id') id: string, @Res() reply: FastifyReply) {
    const artworkDir = this.config.get<string>('artwork_dir', path.join(process.cwd(), 'data', 'artwork'));

    const version = await this.db
      .select()
      .from(schema.album_versions)
      .where(eq(schema.album_versions.id, id))
      .get();

    let artworkPath = version?.artwork_path;

    if (!artworkPath) {
      const playlist = await this.db
        .select({ artwork_path: schema.playlists.artwork_path })
        .from(schema.playlists)
        .where(eq(schema.playlists.id, id))
        .get();
      artworkPath = playlist?.artwork_path;
    }

    if (!artworkPath) {
      const track = await this.db
        .select({ thumbnail_path: schema.tracks.thumbnail_path })
        .from(schema.tracks)
        .where(eq(schema.tracks.id, id))
        .get();
      artworkPath = track?.thumbnail_path;
    }

    if (!artworkPath || !fs.existsSync(artworkPath)) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Artwork not found' });
    }

    const ext = path.extname(artworkPath).toLowerCase();
    const mimeTypes: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    reply.header('Content-Type', mimeTypes[ext] ?? 'image/jpeg');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(fs.createReadStream(artworkPath));
  }

  @Public()
  @Get('lyrics/:track_id')
  @ApiOperation({ summary: 'Get track lyrics (all available languages)' })
  async lyrics(@Param('track_id') trackId: string) {
    return this.db
      .select()
      .from(schema.lyrics)
      .where(eq(schema.lyrics.track_id, trackId));
  }
}
