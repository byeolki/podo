import { Controller, Post, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiConsumes, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { UploadService } from './upload.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOnly } from '../common/decorators/roles.decorator';
import { Readable } from 'stream';

@ApiTags('upload')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@AdminOnly()
@Controller('api/v1/upload')
export class UploadController {
  constructor(private readonly upload: UploadService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload one or more audio/video files (admin only)' })
  async uploadFiles(@Req() req: FastifyRequest) {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected multipart/form-data');
    }

    const results: Array<{ filename: string; path?: string; error?: string }> = [];
    const parts = req.parts();

    for await (const part of parts) {
      if (part.type !== 'file') continue;
      try {
        const result = await this.upload.handleUpload(part.filename, part.file as unknown as Readable);
        results.push({ filename: part.filename, path: result.path });
      } catch (e: unknown) {
        results.push({ filename: part.filename, error: (e as Error).message });
      }
    }

    return { uploaded: results };
  }
}
