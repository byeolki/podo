import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScannerService } from '../library/scanner.service';
import { eq, and, isNull, like, inArray } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import * as path from 'path';
import * as fs from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const ALLOWED_EXTS = new Set(['.mp3', '.m4a', '.flac', '.aac', '.wav', '.ogg', '.opus', '.mp4', '.m4v', '.mkv']);
const MAX_FILE_SIZE = 500 * 1024 * 1024;
// Strips path separators and control characters, and keeps letters and digits in
// any script. The previous allowlist named Hangul explicitly and nothing else, so
// a Japanese or Chinese filename came out as a row of underscores — "米津玄師 -
// Lemon.m4a" was stored as "_____ - Lemon.m4a", losing the name and defeating any
// later attempt to match the file by it.
const FILENAME_SANITIZE = /[\p{C}\p{Zl}\p{Zp}\\/:*?"<>|]/gu;

export interface FileEntry {
  source_id: string;
  track_id: string;
  track_title: string;
  filename: string;
  path: string;
  file_size: number | null;
  added_at: Date | null;
  added_by_name: string | null;
  source_url: string | null;
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly uploadDir: string;

  constructor(
    private readonly config: ConfigService,
    private readonly scanner: ScannerService,
    @Inject(DB_TOKEN) private readonly db: Db,
  ) {
    this.uploadDir = config.get<string>('upload_dir', path.join(process.cwd(), 'data', 'uploads'));
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  /**
   * `fileStream` is a multipart part. `@fastify/multipart` enforces the size
   * limit while it streams and flags the part `truncated` rather than throwing,
   * so that flag — not a byte count — is what says the file was too big.
   *
   * There was a `fileSize` parameter here doing that job, but no caller ever
   * passed it, so the pre-check was always false and the only thing standing
   * between a 600MB file and the disk was a `statSync` *after* it had all been
   * written.
   */
  async handleUpload(
    filename: string,
    fileStream: Readable,
  ): Promise<{ path: string; track_id?: string }> {
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      throw new BadRequestException(`Unsupported file type: ${ext}`);
    }

    const sanitizedName = path.basename(filename).replace(FILENAME_SANITIZE, '_');
    const destPath = path.join(this.uploadDir, `${Date.now()}_${sanitizedName}`);

    try {
      await pipeline(fileStream, fs.createWriteStream(destPath));
    } catch (e) {
      // A stream that fails halfway used to leave its partial file sitting in
      // the upload directory forever.
      fs.rmSync(destPath, { force: true });
      throw new BadRequestException(`Upload failed: ${(e as Error).message}`);
    }

    // Set by the multipart parser once the part passed `limits.fileSize`.
    if ((fileStream as Readable & { truncated?: boolean }).truncated) {
      fs.rmSync(destPath, { force: true });
      throw new BadRequestException('File too large (max 500MB)');
    }

    const stat = fs.statSync(destPath);
    if (stat.size > MAX_FILE_SIZE) {
      fs.rmSync(destPath, { force: true });
      throw new BadRequestException('File too large (max 500MB)');
    }

    this.logger.log(`Uploaded: ${destPath}`);

    await this.scanner.scanFile(destPath);

    return { path: destPath };
  }

  /**
   * The track ids the given uploaded files became, for the ones the scanner has
   * picked up so far.
   *
   * Upload answers with paths, but a path isn't a track — the scanner imports in
   * the background, and until it does there is nothing to edit. The uploader was
   * left to find their own files again in a library sorted by date, which is the
   * one moment they most want to correct a title. Returning the subset that has
   * landed lets the page fill in as the import proceeds.
   */
  async resolveImported(paths: string[], userId: string, isAdmin: boolean): Promise<string[]> {
    if (!paths.length) return [];
    // Confined to the upload directory for the same reason `listFiles` is: these
    // are ids supplied by a client, and nothing outside what this service wrote
    // is any of its business.
    const wanted = paths.filter((p) => p.startsWith(`${this.uploadDir}/`));
    if (!wanted.length) return [];

    const rows = await this.db
      .select({ track_id: schema.sources.track_id })
      .from(schema.sources)
      .innerJoin(schema.tracks, eq(schema.sources.track_id, schema.tracks.id))
      .where(
        and(
          inArray(schema.sources.locator, wanted),
          isNull(schema.sources.deleted_at),
          isNull(schema.tracks.deleted_at),
          isAdmin ? undefined : eq(schema.tracks.added_by, userId),
        ),
      );

    // A video and its audio sibling share one track, so the same id can come back
    // twice for two uploaded files.
    return [...new Set(rows.map((r) => r.track_id))];
  }

  async listFiles(userId: string, isAdmin: boolean): Promise<FileEntry[]> {
    const rows = await this.db
      .select({
        source_id: schema.sources.id,
        track_id: schema.sources.track_id,
        track_title: schema.tracks.title,
        path: schema.sources.locator,
        file_size: schema.sources.file_size,
        added_at: schema.tracks.added_at,
        added_by: schema.tracks.added_by,
        added_by_name: schema.users.name,
        source_url: schema.sources.source_url,
      })
      .from(schema.sources)
      .innerJoin(schema.tracks, eq(schema.sources.track_id, schema.tracks.id))
      .leftJoin(schema.users, eq(schema.tracks.added_by, schema.users.id))
      .where(
        and(
          like(schema.sources.locator, `${this.uploadDir}/%`),
          isNull(schema.sources.deleted_at),
          isNull(schema.tracks.deleted_at),
          isAdmin ? undefined : eq(schema.tracks.added_by, userId),
        ),
      );

    return rows.map((r) => ({
      source_id: r.source_id,
      track_id: r.track_id,
      track_title: r.track_title,
      filename: path.basename(r.path),
      path: r.path,
      file_size: r.file_size,
      added_at: r.added_at,
      added_by_name: r.added_by_name ?? null,
      source_url: r.source_url,
    }));
  }

  async renameFile(sourceId: string, newFilename: string, userId: string, isAdmin: boolean): Promise<void> {
    const source = await this.db
      .select({ id: schema.sources.id, track_id: schema.sources.track_id, locator: schema.sources.locator })
      .from(schema.sources)
      .where(and(eq(schema.sources.id, sourceId), isNull(schema.sources.deleted_at)))
      .get();

    if (!source) throw new NotFoundException('Source not found');

    const track = await this.db
      .select({ added_by: schema.tracks.added_by })
      .from(schema.tracks)
      .where(eq(schema.tracks.id, source.track_id))
      .get();

    if (!track) throw new NotFoundException('Track not found');
    if (!isAdmin && track.added_by !== userId) throw new ForbiddenException('Not your file');

    const oldPath = source.locator;
    const dir = path.dirname(oldPath);
    const oldExt = path.extname(oldPath);
    const oldStem = path.basename(oldPath, oldExt);

    const sanitized = newFilename.replace(FILENAME_SANITIZE, '_');
    const newExt = path.extname(sanitized) || oldExt;
    const newStem = path.basename(sanitized, path.extname(sanitized)) || oldStem;
    const newPath = path.join(dir, `${newStem}${newExt}`);

    if (oldPath === newPath) return;

    const siblings = await this.db
      .select({ id: schema.sources.id, locator: schema.sources.locator })
      .from(schema.sources)
      .where(
        and(
          eq(schema.sources.track_id, source.track_id),
          isNull(schema.sources.deleted_at),
        ),
      );

    const toRename: Array<{ id: string; oldLoc: string; newLoc: string }> = [];

    for (const sib of siblings) {
      const sibDir = path.dirname(sib.locator);
      const sibExt = path.extname(sib.locator);
      const sibStem = path.basename(sib.locator, sibExt);

      if (sibDir === dir && sibStem === oldStem) {
        toRename.push({
          id: sib.id,
          oldLoc: sib.locator,
          newLoc: path.join(dir, `${newStem}${sibExt}`),
        });
      }
    }

    for (const r of toRename) {
      if (r.oldLoc !== r.newLoc) {
        fs.renameSync(r.oldLoc, r.newLoc);
      }
    }

    for (const r of toRename) {
      await this.db
        .update(schema.sources)
        .set({ locator: r.newLoc, updated_at: new Date() })
        .where(eq(schema.sources.id, r.id));
    }

    this.logger.log(`Renamed: ${oldPath} -> ${newPath}`);
  }

  async deleteFile(sourceId: string, userId: string, isAdmin: boolean): Promise<void> {
    const source = await this.db
      .select({ id: schema.sources.id, track_id: schema.sources.track_id, locator: schema.sources.locator })
      .from(schema.sources)
      .where(and(eq(schema.sources.id, sourceId), isNull(schema.sources.deleted_at)))
      .get();

    if (!source) throw new NotFoundException('Source not found');

    const track = await this.db
      .select({ id: schema.tracks.id, added_by: schema.tracks.added_by })
      .from(schema.tracks)
      .where(eq(schema.tracks.id, source.track_id))
      .get();

    if (!track) throw new NotFoundException('Track not found');
    if (!isAdmin && track.added_by !== userId) throw new ForbiddenException('Not your file');

    try {
      fs.unlinkSync(source.locator);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }

    const now = new Date();
    await this.db
      .update(schema.sources)
      .set({ deleted_at: now, available: false, updated_at: now })
      .where(eq(schema.sources.id, sourceId));

    const remaining = await this.db
      .select({ id: schema.sources.id })
      .from(schema.sources)
      .where(and(eq(schema.sources.track_id, source.track_id), isNull(schema.sources.deleted_at)));

    if (remaining.length === 0) {
      await this.db
        .update(schema.tracks)
        .set({ deleted_at: now, updated_at: now })
        .where(eq(schema.tracks.id, source.track_id));
      this.logger.log(`Soft-deleted track ${source.track_id} (no remaining sources)`);
    }

    this.logger.log(`Deleted file: ${source.locator}`);
  }
}
