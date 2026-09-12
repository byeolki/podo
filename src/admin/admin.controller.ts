import { Controller, Get, Post, Put, Delete, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { IsIn, IsOptional, IsBoolean, IsString, MinLength, MaxLength } from 'class-validator';
import { AdminService } from './admin.service';
import { AiService } from '../ai/ai.service';
import { AiProviderName } from '../ai/ai.config';
import { UploadService } from '../upload/upload.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOnly } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/guards/jwt-auth.guard';

class ReviewMappingDto {
  @IsIn(['approve', 'reject']) action!: 'approve' | 'reject';
}

class RenameFileDto {
  // Undecorated, this was stripped by the global `whitelist: true` pipe, so the
  // handler always received `undefined` and every rename 500'd.
  @IsString() @MinLength(1) @MaxLength(255) filename!: string;
}

class UpdateAiDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsIn(['openai', 'claude-code']) provider?: AiProviderName;
  /** Free text on purpose: a newer model shouldn't need a server release. */
  @IsOptional() @IsString() @MaxLength(100) model?: string;
  @IsOptional() @IsBoolean() chat_enabled?: boolean;
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@AdminOnly()
@Controller('api/v1/admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly upload: UploadService,
    private readonly ai: AiService,
  ) {}

  @Get('ai')
  @ApiOperation({ summary: 'AI provider settings and whether the selected one can run' })
  getAiSettings() {
    return this.ai.getStatus();
  }

  @Put('ai')
  @ApiOperation({ summary: 'Change the AI provider, model, or switches' })
  updateAiSettings(@Body() dto: UpdateAiDto) {
    return this.ai.updateSettings(dto);
  }

  @Post('library/verify')
  @ApiOperation({ summary: 'Verify library integrity (check for missing files, orphan metadata)' })
  verify() {
    return this.admin.verifyLibraryIntegrity();
  }

  @Post('library/thumbnails/rebuild')
  @ApiOperation({ summary: 'Regenerate track thumbnails that are missing, blank, or point at a file that is gone' })
  rebuildThumbnails() {
    return this.admin.rebuildThumbnails();
  }

  @Delete('cache/transcode')
  @ApiOperation({ summary: 'Clear transcoding cache' })
  clearCache() {
    return this.admin.clearTranscodeCache();
  }

  @Get('streams')
  @ApiOperation({ summary: 'Get active stream sessions' })
  getActiveStreams() {
    return this.admin.getActiveStreams();
  }

  @Get('stats/traffic')
  @ApiOperation({ summary: 'Get traffic and transcoding stats' })
  @ApiQuery({ name: 'period', required: false, enum: ['day', 'week', 'month', 'all'] })
  getTrafficStats(@Query('period') period?: 'day' | 'week' | 'month' | 'all') {
    return this.admin.getTrafficStats(period ?? 'all');
  }

  @Get('storage')
  @ApiOperation({ summary: 'Get storage breakdown by category' })
  getStorage() {
    return this.admin.getStorageBreakdown();
  }

  @Get('mapping-queue')
  @ApiOperation({ summary: 'List mapping queue entries' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'approved', 'rejected'] })
  listMappingQueue(@Query('status') status?: string) {
    return this.admin.listMappingQueue(status ?? 'pending');
  }

  @Post('mapping-queue/:id/review')
  @ApiOperation({ summary: 'Approve or reject a mapping queue entry' })
  reviewMapping(
    @Param('id') id: string,
    @Body() dto: ReviewMappingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.admin.reviewMappingQueue(id, dto.action, user.sub);
  }

  @Get('users')
  @ApiOperation({ summary: 'List all users' })
  listUsers() {
    return this.admin.listUsers();
  }

  @Get('files')
  @ApiOperation({ summary: 'List all uploaded files' })
  listFiles(@CurrentUser() user: JwtPayload) {
    return this.upload.listFiles(user.sub, true);
  }

  @Patch('files/:sourceId')
  @ApiOperation({ summary: 'Rename an uploaded file' })
  renameFile(
    @Param('sourceId') sourceId: string,
    @Body() dto: RenameFileDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.upload.renameFile(sourceId, dto.filename, user.sub, true);
  }

  @Delete('files/:sourceId')
  @ApiOperation({ summary: 'Delete an uploaded file' })
  deleteFile(
    @Param('sourceId') sourceId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.upload.deleteFile(sourceId, user.sub, true);
  }
}
