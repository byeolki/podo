import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { SearchService } from './search.service';

@ApiTags('search')
@ApiBearerAuth()
@Controller('api/v1/search')
export class SearchController {
  constructor(private readonly searchSvc: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Full-text search across tracks, artists, albums' })
  @ApiQuery({ name: 'q', required: true, type: String })
  @ApiQuery({ name: 'type', required: false, type: String, description: 'Comma-separated: track,artist,album' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  query(
    @Query('q') q: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    const types = type ? type.split(',').map((t) => t.trim()) : ['track', 'artist', 'album'];
    const n = limit ? Math.min(parseInt(limit, 10), 100) : 20;
    return this.searchSvc.search(q ?? '', types, n);
  }
}
