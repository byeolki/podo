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
const FILENAME_SANITIZE = /[^a-zA-Z0-9._\-\s가-힣ㄱ-ㅎㅏ-ㅣ]/g;

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

  async handleUpload(
    filename: string,
    fileStream: Readable,
    fileSize?: number,
  ): Promise<{ path: string; track_id?: string }> {
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      throw new BadRequestException(`Unsupported file type: ${ext}`);
    }

    if (fileSize && fileSize > MAX_FILE_SIZE) {
      throw new BadRequestException('File too large (max 500MB)');
    }

    const sanitizedName = path.basename(filename).replace(/[^a-zA-Z0-9._\-\s]/g, '_');
    const destPath = path.join(this.uploadDir, `${Date.now()}_${sanitizedName}`);

    await pipeline(fileStream, fs.createWriteStream(destPath));

    const stat = fs.statSync(destPath);
    if (stat.size > MAX_FILE_SIZE) {
      fs.unlinkSync(destPath);
      throw new BadRequestException('File too large (max 500MB)');
    }

    this.logger.log(`Uploaded: ${destPath}`);

    await this.scanner.scanFile(destPath);

    return { path: destPath };
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
