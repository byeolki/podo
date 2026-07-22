import { Injectable, Logger, NotFoundException, InternalServerErrorException, Inject } from '@nestjs/common';
import { eq, and, asc, isNull } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { TranscodeCacheService } from './transcode-cache.service';
import { newId } from '../common/id';
import { spawn, ChildProcess } from 'child_process';
import { PassThrough } from 'stream';
import * as fs from 'fs';
import * as mime from 'mime-types';
import { FastifyReply, FastifyRequest } from 'fastify';

export interface StreamRequest {
  trackId: string;
  userId: string;
  userRole: string;
  mediaKind?: 'audio' | 'video';
  sourceId?: string;
  format?: string;
  bitrate?: number;
  seekMs?: number;
  normalize?: boolean;
}

@Injectable()
export class StreamingService {
  private readonly logger = new Logger(StreamingService.name);
  private readonly activeProcesses = new Map<string, ChildProcess>();

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly cache: TranscodeCacheService,
  ) {}

  async resolveSource(req: StreamRequest): Promise<typeof schema.sources.$inferSelect> {
    if (req.sourceId) {
      const source = await this.db
        .select()
        .from(schema.sources)
        .where(and(eq(schema.sources.id, req.sourceId), eq(schema.sources.available, true), isNull(schema.sources.deleted_at)))
        .get();
      if (!source) throw new NotFoundException('Source not found or unavailable');
      return source;
    }

    const kind = req.mediaKind ?? 'audio';

    if (kind === 'video') {
      const override = await this.db
        .select({ video_locator: schema.track_metadata_overrides.video_locator })
        .from(schema.track_metadata_overrides)
        .where(eq(schema.track_metadata_overrides.track_id, req.trackId))
        .get();
      if (override?.video_locator && fs.existsSync(override.video_locator)) {
        return {
          id: `override:${req.trackId}`,
          track_id: req.trackId,
          media_kind: 'video',
          origin: 'local',
          locator: override.video_locator,
          available: true,
          format: null, codec: null, bitrate: null, sample_rate: null, channels: null,
          duration: null, time_offset: 0, priority: 0, file_hash: null, file_size: null,
          replaygain_track: null, replaygain_album: null,
          updated_at: new Date(), created_at: new Date(), deleted_at: null,
        } as typeof schema.sources.$inferSelect;
      }
    }

    let sources = await this.db
      .select()
      .from(schema.sources)
      .where(and(eq(schema.sources.track_id, req.trackId), eq(schema.sources.media_kind, kind), eq(schema.sources.available, true), isNull(schema.sources.deleted_at)))
      .orderBy(asc(schema.sources.priority));

    if (sources.length === 0 && !req.mediaKind) {
      sources = await this.db
        .select()
        .from(schema.sources)
        .where(and(eq(schema.sources.track_id, req.trackId), eq(schema.sources.available, true), isNull(schema.sources.deleted_at)))
        .orderBy(asc(schema.sources.priority));
    }

    if (sources.length === 0) throw new NotFoundException('No available source for this track');

    for (const source of sources) {
      if (fs.existsSync(source.locator)) return source;
      this.logger.warn(`Source file missing, marking unavailable: ${source.locator}`);
      await this.db.update(schema.sources).set({ available: false, updated_at: new Date() }).where(eq(schema.sources.id, source.id));
    }

    throw new NotFoundException('All sources are unavailable');
  }

  async stream(req: StreamRequest, httpReq: FastifyRequest, reply: FastifyReply): Promise<void> {
    const source = await this.resolveSource(req);
    const filePath = source.locator;

    let fileStat: fs.Stats;
    try {
      fileStat = fs.statSync(filePath);
    } catch (e) {
      this.logger.error(`File disappeared after source resolution: ${filePath}`, (e as Error).message);
      await this.db.update(schema.sources).set({ available: false, updated_at: new Date() }).where(eq(schema.sources.id, source.id));
      throw new NotFoundException('Source file no longer available');
    }

    const sessionId = newId();
    await this.createStreamSession(sessionId, req, source);

    reply.raw.on('close', () => {
      this.killProcess(sessionId);
      void this.endStreamSession(sessionId);
    });

    // A manual per-track volume override always applies, regardless of which client
    // is streaming or whether it asked for `normalize` — it's a property of the track,
    // not of the request.
    const override = await this.db
      .select({ volume_db: schema.track_metadata_overrides.volume_db })
      .from(schema.track_metadata_overrides)
      .where(eq(schema.track_metadata_overrides.track_id, req.trackId))
      .get();
    const manualVolumeDb = override?.volume_db ?? null;

    const needsTranscode = this.needsTranscode(source, req.format, req.bitrate) || !!req.normalize || !!manualVolumeDb;
    if (!needsTranscode) {
      await this.servePassthrough(filePath, fileStat.size, source, httpReq, reply);
    } else {
      await this.serveTranscoded(source, req, httpReq, reply, sessionId, manualVolumeDb);
    }
  }

  private async servePassthrough(
    filePath: string,
    fileSize: number,
    source: typeof schema.sources.$inferSelect,
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const contentType = this.sourceContentType(source);
    const rangeHeader = req.headers.range;

    if (!rangeHeader) {
      reply.header('Content-Type', contentType);
      reply.header('Content-Length', fileSize);
      reply.header('Accept-Ranges', 'bytes');
      return reply.send(fs.createReadStream(filePath));
    }

    const { start, end } = this.parseRange(rangeHeader, fileSize);
    const chunkSize = end - start + 1;

    reply.status(206);
    reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    reply.header('Content-Length', chunkSize);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', contentType);
    return reply.send(fs.createReadStream(filePath, { start, end }));
  }

  private async serveTranscoded(
    source: typeof schema.sources.$inferSelect,
    req: StreamRequest,
    httpReq: FastifyRequest,
    reply: FastifyReply,
    sessionId: string,
    manualVolumeDb: number | null = null,
  ): Promise<void> {
    const targetFormat = req.format ?? 'aac';
    const targetBitrate = req.bitrate ?? 256;

    let startMs = req.seekMs ?? 0;
    if (!startMs) {
      const rangeHeader = httpReq.headers.range;
      if (rangeHeader && source.duration && source.bitrate) {
        const approxFileSize = Math.floor((source.bitrate * 1000 / 8) * (source.duration / 1000));
        const { start } = this.parseRange(rangeHeader, approxFileSize);
        startMs = Math.floor((start / approxFileSize) * source.duration);
      }
    }

    const cacheKey = this.cache.getCacheKey(source.id, targetFormat, targetBitrate, startMs, req.normalize, manualVolumeDb);

    if (this.cache.has(cacheKey)) {
      const cachePath = this.cache.getCachePath(cacheKey);
      try {
        const stat = fs.statSync(cachePath);
        reply.header('Content-Type', this.mimeType(targetFormat));
        reply.header('Content-Length', stat.size);
        reply.header('X-Cache', 'HIT');
        return reply.send(fs.createReadStream(cachePath));
      } catch {
        this.logger.warn(`Cache file missing for key ${cacheKey}, falling through to transcode`);
        this.cache.evict(cacheKey);
      }
    }

    const startSecs = startMs / 1000;
    const ffmpegArgs = this.buildFfmpegArgs(source.locator, targetFormat, targetBitrate, startSecs, req.normalize, source.replaygain_track, manualVolumeDb);

    reply.header('Content-Type', this.mimeType(targetFormat));
    reply.header('Accept-Ranges', 'none');
    reply.header('X-Cache', 'MISS');

    const cachePath = this.cache.getCachePath(cacheKey);
    let cacheWriteStream: fs.WriteStream;
    try {
      cacheWriteStream = fs.createWriteStream(cachePath);
    } catch (e) {
      this.logger.error(`Failed to create cache write stream: ${cachePath}`, (e as Error).message);
      throw new InternalServerErrorException('Transcoding cache unavailable');
    }

    const passthrough = new PassThrough();
    const proc = spawn('ffmpeg', ffmpegArgs);
    this.activeProcesses.set(sessionId, proc);

    cacheWriteStream.on('error', (err) => {
      this.logger.error(`Cache write stream error for ${cachePath}: ${err.message}`);
      try { fs.unlinkSync(cachePath); } catch {}
    });

    proc.stdout.on('data', (chunk: Buffer) => {
      cacheWriteStream.write(chunk);
      passthrough.push(chunk);
    });

    proc.stdout.on('end', () => {
      passthrough.push(null);
    });

    proc.stdout.on('error', (err) => {
      passthrough.destroy(err);
    });

    proc.on('close', (_code, signal) => {
      this.activeProcesses.delete(sessionId);
      if (signal === 'SIGKILL') {
        cacheWriteStream.destroy();
        try { fs.unlinkSync(cachePath); } catch {}
      } else {
        cacheWriteStream.end();
        void this.cache.markWritten(cacheKey);
      }
    });

    proc.on('error', (err) => {
      this.logger.error(`ffmpeg spawn error: ${err.message}`);
      this.activeProcesses.delete(sessionId);
      cacheWriteStream.destroy();
      passthrough.destroy(err);
      try { fs.unlinkSync(cachePath); } catch {}
    });

    proc.stderr.on('data', (d: Buffer) => {
      this.logger.verbose(`ffmpeg: ${d.toString().trim()}`);
    });

    return reply.send(passthrough);
  }

  private buildFfmpegArgs(
    inputPath: string,
    format: string,
    bitrate: number,
    startSecs: number,
    normalize?: boolean,
    replaygainDb?: number | null,
    manualVolumeDb?: number | null,
  ): string[] {
    const args: string[] = ['-v', 'error'];

    if (startSecs > 0) args.push('-ss', startSecs.toFixed(3));
    args.push('-i', inputPath);
    args.push('-vn');

    // Auto-leveling (normalize) and the manual per-track override are independent and
    // compose: normalize brings the track to a consistent baseline, the manual dB
    // adjustment is the user's own correction on top of (or instead of) that baseline.
    const audioFilters: string[] = [];
    if (normalize) {
      audioFilters.push(replaygainDb != null
        ? `volume=${replaygainDb >= 0 ? '+' : ''}${replaygainDb.toFixed(2)}dB`
        : 'loudnorm=I=-16:TP=-1.5:LRA=11');
    }
    if (manualVolumeDb) {
      audioFilters.push(`volume=${manualVolumeDb >= 0 ? '+' : ''}${manualVolumeDb.toFixed(2)}dB`);
    }
    if (audioFilters.length) args.push('-af', audioFilters.join(','));

    args.push('-b:a', `${bitrate}k`);

    if (format === 'aac' || format === 'm4a') {
      args.push('-c:a', 'aac', '-f', 'adts');
    } else if (format === 'opus') {
      args.push('-c:a', 'libopus', '-f', 'ogg');
    } else if (format === 'mp3') {
      args.push('-c:a', 'libmp3lame', '-f', 'mp3');
    } else {
      args.push('-c:a', 'aac', '-f', 'adts');
    }

    args.push('pipe:1');
    return args;
  }

  private killProcess(sessionId: string): void {
    const proc = this.activeProcesses.get(sessionId);
    if (proc) {
      proc.kill('SIGKILL');
      this.activeProcesses.delete(sessionId);
    }
  }

  private needsTranscode(source: typeof schema.sources.$inferSelect, targetFormat?: string, targetBitrate?: number): boolean {
    if (!targetFormat && !targetBitrate) return false;
    const fmtMismatch = targetFormat && source.format && !source.format.includes(targetFormat);
    const bitrateTooHigh = targetBitrate && source.bitrate && source.bitrate > targetBitrate * 1.1;
    return Boolean(fmtMismatch || bitrateTooHigh);
  }

  private parseRange(rangeHeader: string, total: number): { start: number; end: number } {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (!match) return { start: 0, end: total - 1 };
    const start = match[1] ? parseInt(match[1], 10) : total - parseInt(match[2] ?? '1', 10);
    const end = match[2] ? parseInt(match[2], 10) : total - 1;
    return {
      start: Math.max(0, Math.min(start, total - 1)),
      end: Math.max(start, Math.min(end, total - 1)),
    };
  }

  private sourceContentType(source: typeof schema.sources.$inferSelect): string {
    const ext = source.locator.split('.').pop()?.toLowerCase() ?? '';
    return (mime.lookup(ext) as string | false) || 'application/octet-stream';
  }

  private mimeType(format: string): string {
    const map: Record<string, string> = { aac: 'audio/aac', opus: 'audio/ogg; codecs=opus', mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4' };
    return map[format] ?? 'audio/aac';
  }

  private async createStreamSession(sessionId: string, req: StreamRequest, source: typeof schema.sources.$inferSelect): Promise<void> {
    await this.db.insert(schema.stream_sessions).values({
      id: sessionId,
      user_id: req.userId,
      track_id: req.trackId,
      source_id: source.id,
      media_kind: source.media_kind,
      format: req.format,
      bitrate: req.bitrate,
    });
  }

  private async endStreamSession(sessionId: string): Promise<void> {
    await this.db.update(schema.stream_sessions).set({ ended_at: new Date() }).where(eq(schema.stream_sessions.id, sessionId));
  }

  getActiveStreams() {
    return [...this.activeProcesses.keys()];
  }
}
