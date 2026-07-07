import { Controller, Post, Get, Param, Query, Body, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { IsUrl, IsOptional, IsBoolean } from 'class-validator';
import { DownloadService } from './download.service';
import { YoutubeService } from './youtube.service';
import { SearchService } from '../search/search.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOnly } from '../common/decorators/roles.decorator';

class StartDownloadDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) url!: string;
  @IsOptional() @IsBoolean() audio_only?: boolean;
}

@ApiTags('download')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@AdminOnly()
@Controller('api/v1/download')
export class DownloadController {
  constructor(
    private readonly download: DownloadService,
    private readonly youtube: YoutubeService,
    private readonly searchService: SearchService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Start a yt-dlp download (admin only)' })
  start(@Body() dto: StartDownloadDto) {
    return this.download.start(dto.url, dto.audio_only ?? true);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search local library first, then YouTube (admin only)' })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async search(@Query('q') q: string, @Query('limit') limitQuery?: string) {
    const limit = limitQuery ? parseInt(limitQuery, 10) : 10;
    const query = q?.trim() ?? '';
    if (!query) return { local: [], youtube: [] };

    const [local, youtube] = await Promise.all([
      Promise.resolve(this.searchService.searchTracksSimple(query, limit)),
      this.youtube.search(query, limit),
    ]);

    return { local, youtube };
  }

  @Get()
  @ApiOperation({ summary: 'List recent download jobs (admin only)' })
  list() {
    return this.download.listJobs();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get download job status (admin only)' })
  getOne(@Param('id') id: string) {
    const job = this.download.getJob(id);
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }
}
