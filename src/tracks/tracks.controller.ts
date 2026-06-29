import {
  Controller, Get, Patch, Post, Param, Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, IsBoolean, IsArray, ArrayNotEmpty, Min, Max } from 'class-validator';
import { TracksService } from './tracks.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/guards/jwt-auth.guard';

class TrackMetadataDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() artist?: string;
  @IsOptional() @IsString() original_artist?: string;
  @IsOptional() @IsBoolean() is_cover?: boolean;
  @IsOptional() @IsString() video_locator?: string;
  @IsOptional() @IsInt() @Min(1) @Max(9999) track_number?: number;
  @IsOptional() @IsInt() @Min(1) @Max(99) disc_number?: number;
}

class BulkMetadataDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) track_ids!: string[];
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsInt() @Min(1) @Max(9999) track_number?: number;
  @IsOptional() @IsInt() @Min(1) @Max(99) disc_number?: number;
}

class CoverMappingDto {
  @IsString() original_track_id!: string;
}

@ApiTags('tracks')
@ApiBearerAuth()
@Controller('api/v1/tracks')
export class TracksController {
  constructor(private readonly tracks: TracksService) {}

  @Get()
  @ApiOperation({ summary: 'List all tracks' })
  findAll() {
    return this.tracks.findAll();
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
