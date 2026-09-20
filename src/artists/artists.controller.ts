import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ArtistsService } from './artists.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/guards/jwt-auth.guard';

@ApiTags('artists')
@ApiBearerAuth()
@Controller('api/v1/artists')
export class ArtistsController {
  constructor(private readonly artists: ArtistsService) {}

  @Get()
  @ApiOperation({ summary: 'Every name credited in the library, with what it is on' })
  findAll() {
    return this.artists.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One artist: tracks they are credited on, and their songs covered here' })
  findOne(@Param('id') id: string, @CurrentUser() user?: JwtPayload) {
    return this.artists.findOne(id, user?.sub);
  }
}
