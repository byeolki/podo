import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AlbumsService } from './albums.service';

@ApiTags('albums')
@ApiBearerAuth()
@Controller('api/v1/albums')
export class AlbumsController {
  constructor(private readonly albums: AlbumsService) {}

  @Get()
  @ApiOperation({ summary: 'List all albums' })
  findAll() {
    return this.albums.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get album with versions and artist' })
  findOne(@Param('id') id: string) {
    return this.albums.findOne(id);
  }
}
