import { Controller, Get, Put, Delete, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FavoritesService } from './favorites.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/guards/jwt-auth.guard';

@ApiTags('favorites')
@ApiBearerAuth()
@Controller('api/v1/favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: 'List favorited tracks' })
  findAll(@CurrentUser() user: JwtPayload) {
    return this.favorites.findAll(user.sub);
  }

  @Put(':track_id')
  @ApiOperation({ summary: 'Add track to favorites' })
  add(@Param('track_id') trackId: string, @CurrentUser() user: JwtPayload) {
    return this.favorites.add(user.sub, trackId);
  }

  @Delete(':track_id')
  @ApiOperation({ summary: 'Remove track from favorites' })
  remove(@Param('track_id') trackId: string, @CurrentUser() user: JwtPayload) {
    return this.favorites.remove(user.sub, trackId);
  }
}
