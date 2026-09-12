import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Req,
  Body,
  Param,
  UseGuards,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiConsumes, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { UploadService } from './upload.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOnly } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/guards/jwt-auth.guard';
import { Readable } from 'stream';

class RenameFileDto {
  filename!: string;
}

@ApiTags('upload')
@ApiBearerAuth()
@Controller('api/v1/upload')
export class UploadController {
  constructor(private readonly upload: UploadService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload one or more audio/video files' })
  async uploadFiles(@Req() req: FastifyRequest) {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected multipart/form-data');
    }

    const results: Array<{ filename: string; path?: string; error?: string }> = [];

    // The whole iteration is guarded, not just each handler. Once a part breaches
    // `limits.fileSize` the multipart parser throws from `parts()` itself, which
    // escaped this loop and surfaced as a bare 500 — an oversized upload reported
    // "Internal server error" rather than saying the file was too large.
    try {
      for await (const part of req.parts()) {
        if (part.type !== 'file') continue;
        try {
          const result = await this.upload.handleUpload(part.filename, part.file as unknown as Readable);
          results.push({ filename: part.filename, path: result.path });
        } catch (e: unknown) {
          results.push({ filename: part.filename, error: (e as Error).message });
        }
      }
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      const message = code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_FILES_LIMIT'
        ? 'File too large (max 500MB)'
        : `Upload failed: ${(e as Error).message}`;
      // Anything that did land before the failure is still reported. The part
      // that breached the limit usually reported itself already — the parser
      // then throws on the *next* read — so don't say it twice.
      if (!results.length) throw new PayloadTooLargeException(message);
      if (results[results.length - 1]?.error !== message) {
        results.push({ filename: 'remaining files', error: message });
      }
    }

    return { uploaded: results };
  }

  @Get('files')
  @ApiOperation({ summary: 'List my uploaded files (admin sees all)' })
  listFiles(@CurrentUser() user: JwtPayload) {
    return this.upload.listFiles(user.sub, user.role === 'admin');
  }

  @Patch('files/:sourceId')
  @ApiOperation({ summary: 'Rename an uploaded file' })
  renameFile(
    @Param('sourceId') sourceId: string,
    @Body() dto: RenameFileDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.upload.renameFile(sourceId, dto.filename, user.sub, user.role === 'admin');
  }

  @Delete('files/:sourceId')
  @ApiOperation({ summary: 'Delete an uploaded file' })
  deleteFile(
    @Param('sourceId') sourceId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.upload.deleteFile(sourceId, user.sub, user.role === 'admin');
  }
}
