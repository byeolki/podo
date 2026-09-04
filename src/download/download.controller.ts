import { Controller, Post, Get, Param, Query, Body, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { IsUrl, IsOptional, IsBoolean } from 'class-validator';
import { DownloadService } from './download.service';
import { YtdlpService } from './ytdlp.service';
import { SearchService } from '../search/search.service';
import { providerFor, looksLikePlaylist, PROVIDER_LABELS } from './providers';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOnly } from '../common/decorators/roles.decorator';

class StartDownloadDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) url!: string;
  @IsOptional() @IsBoolean() audio_only?: boolean;
  /**
   * Force playlist expansion on/off. Omitted, the server decides from the URL:
   * a share link that merely carries `&list=` is treated as one item.
   */
  @IsOptional() @IsBoolean() allow_playlist?: boolean;
}

@ApiTags('download')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@AdminOnly()
@Controller('api/v1/download')
export class DownloadController {
  constructor(
    private readonly download: DownloadService,
    private readonly ytdlp: YtdlpService,
    private readonly searchService: SearchService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Download from any yt-dlp-supported site (admin only)' })
  start(@Body() dto: StartDownloadDto) {
    return this.download.start(dto.url, dto.audio_only ?? true, { allowPlaylist: dto.allow_playlist });
  }

  @Get('inspect')
  @ApiOperation({ summary: 'Classify a URL before downloading it (admin only)' })
  @ApiQuery({ name: 'url', required: true })
  inspect(@Query('url') url: string) {
    return {
      url,
      provider: providerFor(url ?? ''),
      provider_label: PROVIDER_LABELS[providerFor(url ?? '')],
      is_playlist: looksLikePlaylist(url ?? ''),
    };
  }

  @Get('search')
  @ApiOperation({ summary: 'Search the local library first, then YouTube (admin only)' })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async search(@Query('q') q: string, @Query('limit') limitQuery?: string) {
    const limit = limitQuery ? parseInt(limitQuery, 10) : 10;
    const query = q?.trim() ?? '';
    if (!query) return { local: [], youtube: [] };

    const [local, youtube] = await Promise.all([
      Promise.resolve(this.searchService.searchTracksSimple(query, limit)),
      this.ytdlp.searchYouTube(query, limit),
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
