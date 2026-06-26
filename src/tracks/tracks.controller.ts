import {
  Controller, Get, Patch, Post, Put, Param, Body, Query, UseGuards,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { TracksService } from './tracks.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/guards/jwt-auth.guard';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';

class TrackMetadataDto {
  title?: string;
  track_number?: number;
  disc_number?: number;
}

class BulkMetadataDto {
  track_ids!: string[];
  title?: string;
  track_number?: number;
  disc_number?: number;
}

class CoverMappingDto {
  original_track_id!: string;
}

@ApiTags('tracks')
@ApiBearerAuth()
@Controller('api/v1/tracks')
export class TracksController {
  constructor(
    private readonly tracks: TracksService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List tracks' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: Number })
  findAll(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.tracks.findAll(
      limit ? Math.min(parseInt(limit, 10), 200) : 50,
      cursor ? parseInt(cursor, 10) : undefined,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get track with sources and artists' })
  findOne(@Param('id') id: string) {
    return this.tracks.findOne(id);
  }

  @Patch(':id/metadata')
  @ApiOperation({ summary: 'Apply metadata override to track' })
  applyOverride(
    @Param('id') id: string,
    @Body() dto: TrackMetadataDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tracks.applyOverride(id, dto, user.sub);
  }

  @Post('bulk-metadata')
  @ApiOperation({ summary: 'Bulk apply metadata override' })
  bulkOverride(
    @Body() dto: BulkMetadataDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tracks.bulkApplyOverride(dto.track_ids, dto, user.sub);
  }

  @Get(':id/lyrics')
  @ApiOperation({ summary: 'Get track lyrics' })
  getLyrics(@Param('id') id: string) {
    return this.tracks.getLyrics(id);
  }

  @Post(':id/mappings')
  @ApiOperation({ summary: 'Create cover song mapping' })
  addCoverMapping(
    @Param('id') id: string,
    @Body() dto: CoverMappingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tracks.addCoverMapping(id, dto.original_track_id, user.sub);
  }
}
