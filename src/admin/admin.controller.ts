import { Controller, Get, Post, Delete, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { AdminService } from './admin.service';
import { UploadService } from '../upload/upload.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOnly } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/guards/jwt-auth.guard';

class ReviewMappingDto {
  @IsIn(['approve', 'reject']) action!: 'approve' | 'reject';
}

class RenameFileDto {
  filename!: string;
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
  ) {}

  @Post('library/verify')
  @ApiOperation({ summary: 'Verify library integrity (check for missing files, orphan metadata)' })
  verify() {
    return this.admin.verifyLibraryIntegrity();
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
