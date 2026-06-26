import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScannerService } from '../library/scanner.service';
import * as path from 'path';
import * as fs from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const ALLOWED_EXTS = new Set(['.mp3', '.m4a', '.flac', '.aac', '.wav', '.ogg', '.opus', '.mp4', '.m4v', '.mkv']);
const MAX_FILE_SIZE = 500 * 1024 * 1024;

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly uploadDir: string;

  constructor(
    private readonly config: ConfigService,
    private readonly scanner: ScannerService,
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
}
