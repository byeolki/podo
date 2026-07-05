import { Injectable, Logger, Inject, NotFoundException, ForbiddenException, GoneException } from '@nestjs/common';
import { eq, and, asc, isNull, desc } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { newId } from '../common/id';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { FastifyReply } from 'fastify';

const ALLOWED_FORMATS = new Set(['mp3', 'aac', 'opus']);
const DEFAULT_BITRATE = 192;

interface RadioSession {
  stop: () => void;
}

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);
  private readonly activeSessions = new Map<string, Set<RadioSession>>();

  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async createToken(playlistId: string, userId: string, isAdmin: boolean, expiresInDays = 90) {
    await this.requirePlaylistAccess(playlistId, userId, isAdmin);

    const id = newId();
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInDays * 86400000);

    await this.db.insert(schema.playlist_radio_tokens).values({
      id,
      playlist_id: playlistId,
      token,
      created_by: userId,
      expires_at: expiresAt,
    });

    this.logger.log(`Radio token created for playlist=${playlistId} by user=${userId}, expires ${expiresAt.toISOString()}`);
    return this.db.select().from(schema.playlist_radio_tokens).where(eq(schema.playlist_radio_tokens.id, id)).get();
  }

  async listForPlaylist(playlistId: string, userId: string, isAdmin: boolean) {
    await this.requirePlaylistAccess(playlistId, userId, isAdmin);
    return this.db
      .select()
      .from(schema.playlist_radio_tokens)
      .where(eq(schema.playlist_radio_tokens.playlist_id, playlistId))
      .orderBy(desc(schema.playlist_radio_tokens.created_at));
  }

  async listAll() {
    return this.db
      .select({
        id: schema.playlist_radio_tokens.id,
        token: schema.playlist_radio_tokens.token,
        playlist_id: schema.playlist_radio_tokens.playlist_id,
        playlist_name: schema.playlists.name,
        created_by_name: schema.users.name,
        created_at: schema.playlist_radio_tokens.created_at,
        expires_at: schema.playlist_radio_tokens.expires_at,
        revoked_at: schema.playlist_radio_tokens.revoked_at,
        last_played_at: schema.playlist_radio_tokens.last_played_at,
      })
      .from(schema.playlist_radio_tokens)
      .leftJoin(schema.playlists, eq(schema.playlist_radio_tokens.playlist_id, schema.playlists.id))
      .leftJoin(schema.users, eq(schema.playlist_radio_tokens.created_by, schema.users.id))
      .orderBy(desc(schema.playlist_radio_tokens.created_at));
  }

  async revoke(id: string, userId: string, isAdmin: boolean) {
    const radioToken = await this.db.select().from(schema.playlist_radio_tokens).where(eq(schema.playlist_radio_tokens.id, id)).get();
    if (!radioToken) throw new NotFoundException('Radio token not found');

    if (!isAdmin) {
      await this.requirePlaylistAccess(radioToken.playlist_id, userId, isAdmin);
    }

    await this.db.update(schema.playlist_radio_tokens).set({ revoked_at: new Date() }).where(eq(schema.playlist_radio_tokens.id, id));
    this.killActiveSessions(id);
    this.logger.log(`Radio token revoked: ${id}`);
  }

  async stream(tokenValue: string, format: string, bitrate: number, shuffle: boolean, reply: FastifyReply): Promise<void> {
    const radioToken = await this.validateToken(tokenValue);
    const safeFormat = ALLOWED_FORMATS.has(format) ? format : 'mp3';
    const safeBitrate = bitrate > 0 && bitrate <= 320 ? bitrate : DEFAULT_BITRATE;

    const tracks = await this.getOrderedTracks(radioToken.playlist_id);
    if (!tracks.length) throw new NotFoundException('Playlist is empty');

    void this.db
      .update(schema.playlist_radio_tokens)
      .set({ last_played_at: new Date() })
      .where(eq(schema.playlist_radio_tokens.id, radioToken.id));

    reply.header('Content-Type', this.mimeType(safeFormat));
    reply.header('Accept-Ranges', 'none');
    reply.header('Cache-Control', 'no-store');
    reply.header('icy-name', 'Podo Radio');

    let stopped = false;
    let currentDecoder: ChildProcess | null = null;

    const encoder = spawn('ffmpeg', this.buildEncoderArgs(safeFormat, safeBitrate));
    encoder.stderr.on('data', () => {});

    const session: RadioSession = {
      stop: () => {
        if (stopped) return;
        stopped = true;
        currentDecoder?.kill('SIGKILL');
        encoder.stdin.end();
        encoder.kill('SIGKILL');
      },
    };

    encoder.on('error', (err) => {
      this.logger.error(`Radio ${radioToken.id}: encoder error: ${err.message}`);
      session.stop();
    });

    let sessions = this.activeSessions.get(radioToken.id);
    if (!sessions) {
      sessions = new Set();
      this.activeSessions.set(radioToken.id, sessions);
    }
    sessions.add(session);

    reply.raw.on('close', () => {
      session.stop();
      sessions?.delete(session);
    });

    void reply.send(encoder.stdout);

    let playOrder = shuffle ? this.shuffleArray(tracks) : tracks;
    let i = 0;
    while (!stopped) {
      if (shuffle && i > 0 && i % playOrder.length === 0) {
        playOrder = this.shuffleArray(tracks);
      }
      const track = playOrder[i % playOrder.length];
      i++;
      try {
        await this.pipeTrackPcm(track.id, encoder.stdin, (p) => { currentDecoder = p; });
      } catch (e) {
        this.logger.warn(`Radio ${radioToken.id}: skipping track ${track.id}: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  private shuffleArray<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  private killActiveSessions(tokenId: string): void {
    const sessions = this.activeSessions.get(tokenId);
    if (!sessions) return;
    for (const session of sessions) session.stop();
    this.activeSessions.delete(tokenId);
  }

  private async validateToken(tokenValue: string) {
    const row = await this.db.select().from(schema.playlist_radio_tokens).where(eq(schema.playlist_radio_tokens.token, tokenValue)).get();
    if (!row) throw new NotFoundException('Invalid radio token');
    if (row.revoked_at) throw new GoneException('This radio stream has been closed');
    if (row.expires_at.getTime() < Date.now()) throw new GoneException('This radio stream has expired');
    return row;
  }

  private async pipeTrackPcm(
    trackId: string,
    encoderStdin: NodeJS.WritableStream,
    setProc: (p: ChildProcess | null) => void,
  ): Promise<void> {
    const source = await this.resolveAudioSource(trackId);
    const args = this.buildDecoderArgs(source.locator);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('ffmpeg', args);
      setProc(proc);

      proc.stdout.pipe(encoderStdin, { end: false });
      proc.stderr.on('data', () => {});

      proc.on('close', () => {
        setProc(null);
        resolve();
      });
      proc.on('error', (err) => {
        setProc(null);
        reject(err);
      });
    });
  }

  private async resolveAudioSource(trackId: string): Promise<typeof schema.sources.$inferSelect> {
    const sources = await this.db
      .select()
      .from(schema.sources)
      .where(and(eq(schema.sources.track_id, trackId), eq(schema.sources.media_kind, 'audio'), eq(schema.sources.available, true), isNull(schema.sources.deleted_at)))
      .orderBy(asc(schema.sources.priority));

    for (const source of sources) {
      if (fs.existsSync(source.locator)) return source;
    }
    throw new Error('No available audio source for track');
  }

  private async getOrderedTracks(playlistId: string): Promise<{ id: string }[]> {
    return this.db
      .select({ id: schema.tracks.id })
      .from(schema.playlist_tracks)
      .innerJoin(schema.tracks, eq(schema.playlist_tracks.track_id, schema.tracks.id))
      .where(and(eq(schema.playlist_tracks.playlist_id, playlistId), isNull(schema.tracks.deleted_at)))
      .orderBy(asc(schema.playlist_tracks.position));
  }

  private buildDecoderArgs(inputPath: string): string[] {
    return ['-v', 'error', '-i', inputPath, '-vn', '-f', 's16le', '-ar', '44100', '-ac', '2', 'pipe:1'];
  }

  private buildEncoderArgs(format: string, bitrate: number): string[] {
    const args = ['-v', 'error', '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'pipe:0', '-b:a', `${bitrate}k`];
    if (format === 'mp3') args.push('-c:a', 'libmp3lame', '-write_xing', '0', '-f', 'mp3');
    else if (format === 'opus') args.push('-c:a', 'libopus', '-f', 'ogg');
    else args.push('-c:a', 'aac', '-f', 'adts');
    args.push('pipe:1');
    return args;
  }

  private mimeType(format: string): string {
    const map: Record<string, string> = { mp3: 'audio/mpeg', aac: 'audio/aac', opus: 'audio/ogg; codecs=opus' };
    return map[format] ?? 'audio/mpeg';
  }

  private async requirePlaylistAccess(playlistId: string, userId: string, isAdmin: boolean): Promise<void> {
    const playlist = await this.db.select().from(schema.playlists).where(eq(schema.playlists.id, playlistId)).get();
    if (!playlist) throw new NotFoundException('Playlist not found');
    if (playlist.owner_user_id !== userId && !isAdmin) throw new ForbiddenException();
  }
}
