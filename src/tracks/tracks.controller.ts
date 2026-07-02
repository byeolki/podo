import {
  Controller, Get, Patch, Post, Param, Body, Query, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, IsBoolean, IsArray, ArrayNotEmpty, Min, Max } from 'class-validator';
import { TracksService, SortOption, FilterOption } from './tracks.service';
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
  @IsOptional() @IsString() alternate_titles?: string;
}

class BulkMetadataDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) track_ids!: string[];
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsInt() @Min(1) @Max(9999) track_number?: number;
  @IsOptional() @IsInt() @Min(1) @Max(99) disc_number?: number;
}

class AiFillDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) track_ids!: string[];
}

class DeleteTracksDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) track_ids!: string[];
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
  findAll(
    @Query('sort') sort?: string,
    @Query('filter') filter?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const validSorts = ['newest', 'oldest', 'popular', 'plays'] as const;
    const validFilters = ['all', 'mine', 'favorites'] as const;
    const sortOpt = (validSorts as readonly string[]).includes(sort ?? '') ? sort as SortOption : 'newest';
    const filterOpt = (validFilters as readonly string[]).includes(filter ?? '') ? filter as FilterOption : 'all';
    return this.tracks.findAll(user?.sub ?? '', { sort: sortOpt, filter: filterOpt, role: user?.role });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get track with sources and artists' })
  findOne(@Param('id') id: string) {
    return this.tracks.findOne(id);
  }

  @Post(':id/play')
  @HttpCode(204)
  @ApiOperation({ summary: 'Record a track play' })
  recordPlay(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.tracks.recordPlay(id, user.sub);
  }

  @Post(':id/favorite')
  @ApiOperation({ summary: 'Toggle track favorite' })
  toggleFavorite(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.tracks.toggleFavorite(id, user.sub);
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

  @Post('delete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft-delete tracks' })
  deleteTracks(@Body() dto: DeleteTracksDto) {
    return this.tracks.deleteTracks(dto.track_ids);
  }

  @Post('ai-fill')
  @ApiOperation({ summary: 'AI auto-fill metadata for one or more tracks' })
  aiFill(
    @Body() dto: AiFillDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tracks.aiAutofill(dto.track_ids, user.sub);
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
