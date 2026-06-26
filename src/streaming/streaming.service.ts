import { Injectable, Logger, NotFoundException, ForbiddenException, Inject } from '@nestjs/common';
import { eq, and, asc, isNull } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { TranscodeCacheService } from './transcode-cache.service';
import { newId } from '../common/id';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import { FastifyReply, FastifyRequest } from 'fastify';

export interface StreamRequest {
  trackId: string;
  userId: string;
  userRole: string;
  mediaKind?: 'audio' | 'video';
  sourceId?: string;
  format?: string;
  bitrate?: number;
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
    const sources = await this.db
      .select()
      .from(schema.sources)
      .where(
        and(
          eq(schema.sources.track_id, req.trackId),
          eq(schema.sources.media_kind, kind),
          eq(schema.sources.available, true),
          isNull(schema.sources.deleted_at),
        ),
      )
      .orderBy(asc(schema.sources.priority));

    if (sources.length === 0) throw new NotFoundException('No available source for this track');

    for (const source of sources) {
      if (fs.existsSync(source.locator)) return source;
      await this.db
        .update(schema.sources)
        .set({ available: false, updated_at: new Date() })
        .where(eq(schema.sources.id, source.id));
    }

    throw new NotFoundException('All sources are unavailable');
  }

  async stream(
    req: StreamRequest,
    httpReq: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const source = await this.resolveSource(req);

    const filePath = source.locator;
    const fileStat = fs.statSync(filePath);
    const fileSize = fileStat.size;

    const requestedBitrate = req.bitrate;
    const needsTranscode = this.needsTranscode(source, req.format, requestedBitrate);

    const sessionId = newId();
    await this.createStreamSession(sessionId, req, source);

    reply.raw.on('close', () => {
      this.killProcess(sessionId);
      void this.endStreamSession(sessionId);
    });

    if (!needsTranscode) {
      await this.servePassthrough(filePath, fileSize, httpReq, reply);
    } else {
      await this.serveTranscoded(source, req, httpReq, reply, sessionId);
    }
  }

  private async servePassthrough(
    filePath: string,
    fileSize: number,
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const rangeHeader = req.headers.range;

    if (!rangeHeader) {
      reply.header('Content-Type', 'audio/flac');
      reply.header('Content-Length', fileSize);
      reply.header('Accept-Ranges', 'bytes');
      const stream = fs.createReadStream(filePath);
      return reply.send(stream);
    }

    const { start, end } = this.parseRange(rangeHeader, fileSize);
    const chunkSize = end - start + 1;

    reply.status(206);
    reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    reply.header('Content-Length', chunkSize);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', 'audio/flac');

    const stream = fs.createReadStream(filePath, { start, end });
    return reply.send(stream);
  }

  private async serveTranscoded(
    source: typeof schema.sources.$inferSelect,
    req: StreamRequest,
    httpReq: FastifyRequest,
    reply: FastifyReply,
    sessionId: string,
  ): Promise<void> {
    const targetFormat = req.format ?? 'aac';
    const targetBitrate = req.bitrate ?? 192;
    const rangeHeader = httpReq.headers.range;

    let startMs = 0;
    if (rangeHeader && source.duration) {
      const { start } = this.parseRange(rangeHeader, source.duration);
      startMs = Math.floor((start / source.duration) * (source.duration));
    }

    const cacheKey = this.cache.getCacheKey(source.id, targetFormat, targetBitrate, startMs);

    if (this.cache.has(cacheKey)) {
      const cachePath = this.cache.getCachePath(cacheKey);
      const stat = fs.statSync(cachePath);
      reply.header('Content-Type', this.mimeType(targetFormat));
      reply.header('Content-Length', stat.size);
      reply.header('X-Cache', 'HIT');
      return reply.send(fs.createReadStream(cachePath));
    }

    const startSecs = startMs / 1000;
    const ffmpegArgs = this.buildFfmpegArgs(source.locator, targetFormat, targetBitrate, startSecs);

    reply.header('Content-Type', this.mimeType(targetFormat));
    reply.header('Accept-Ranges', 'none');
    reply.header('X-Cache', 'MISS');

    const cachePath = this.cache.getCachePath(cacheKey);
    const cacheWriteStream = fs.createWriteStream(cachePath);

    const proc = spawn('ffmpeg', ffmpegArgs);
    this.activeProcesses.set(sessionId, proc);

    proc.stdout.pipe(cacheWriteStream);

    const { PassThrough } = await import('stream');
    const passthrough = new PassThrough();
    proc.stdout.pipe(passthrough);

    proc.on('close', () => {
      this.activeProcesses.delete(sessionId);
      cacheWriteStream.end();
      void this.cache.markWritten(cacheKey);
    });

    proc.on('error', (err) => {
      this.logger.error(`ffmpeg error: ${err.message}`);
      this.activeProcesses.delete(sessionId);
      cacheWriteStream.destroy();
      try { fs.unlinkSync(cachePath); } catch {}
    });

    return reply.send(passthrough);
  }

  private buildFfmpegArgs(
    inputPath: string,
    format: string,
    bitrate: number,
    startSecs: number,
  ): string[] {
    const args: string[] = ['-v', 'error'];

    if (startSecs > 0) {
      args.push('-ss', startSecs.toFixed(3));
    }

    args.push('-i', inputPath);
    args.push('-vn');
    args.push('-b:a', `${bitrate}k`);

    if (format === 'aac' || format === 'm4a') {
      args.push('-c:a', 'aac', '-f', 'adts');
    } else if (format === 'opus') {
      args.push('-c:a', 'libopus', '-f', 'opus');
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

  private needsTranscode(
    source: typeof schema.sources.$inferSelect,
    targetFormat?: string,
    targetBitrate?: number,
  ): boolean {
    if (targetFormat && source.format && !source.format.includes(targetFormat)) return true;
    if (targetBitrate && source.bitrate && source.bitrate > targetBitrate * 1.1) return true;
    if (targetFormat && targetFormat !== 'flac' && targetFormat !== 'wav') return true;
    return false;
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

  private mimeType(format: string): string {
    const map: Record<string, string> = {
      aac: 'audio/aac',
      opus: 'audio/ogg; codecs=opus',
      mp3: 'audio/mpeg',
      flac: 'audio/flac',
      m4a: 'audio/mp4',
    };
    return map[format] ?? 'audio/aac';
  }

  private async createStreamSession(
    sessionId: string,
    req: StreamRequest,
    source: typeof schema.sources.$inferSelect,
  ): Promise<void> {
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
    await this.db
      .update(schema.stream_sessions)
      .set({ ended_at: new Date() })
      .where(eq(schema.stream_sessions.id, sessionId));
  }

  getActiveStreams() {
    return [...this.activeProcesses.keys()];
  }
}
