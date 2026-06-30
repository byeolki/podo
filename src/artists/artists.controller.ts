import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ArtistsService } from './artists.service';

@ApiTags('artists')
@ApiBearerAuth()
@Controller('api/v1/artists')
export class ArtistsController {
  constructor(private readonly artists: ArtistsService) {}

  @Get()
  @ApiOperation({ summary: 'List all artists' })
  findAll() {
    return this.artists.findAll();
  }

  @Get(':name')
  @ApiOperation({ summary: 'Get artist with tracks' })
  findByName(@Param('name') name: string) {
    return this.artists.findByName(decodeURIComponent(name));
  }
}
