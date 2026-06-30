import { Controller, Get, Post, Query, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { RadioService } from './radio.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/guards/jwt-auth.guard';

class CreateMixDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() seed_track_id?: string;
  @IsOptional() @IsString() seed_artist_name?: string;
  @IsOptional() @IsInt() @Min(1) @Max(200) count?: number;
}

@ApiTags('radio')
@ApiBearerAuth()
@Controller('api/v1/radio')
export class RadioController {
  constructor(private readonly radio: RadioService) {}

  @Get()
  @ApiOperation({ summary: 'Get a radio station (ordered track list based on seed)' })
  @ApiQuery({ name: 'seed_track_id', required: false })
  @ApiQuery({ name: 'seed_artist_name', required: false })
  @ApiQuery({ name: 'count', required: false, type: Number })
  @ApiQuery({ name: 'exclude', required: false, description: 'Comma-separated track IDs to exclude' })
  getStation(
    @Query('seed_track_id') seedTrackId?: string,
    @Query('seed_artist_name') seedArtistName?: string,
    @Query('count') count?: string,
    @Query('exclude') exclude?: string,
  ) {
    return this.radio.getStation({
      seedTrackId,
      seedArtistName,
      count: count ? parseInt(count, 10) : undefined,
      excludeIds: exclude ? exclude.split(',').map((s) => s.trim()).filter(Boolean) : [],
    });
  }

  @Post('mix')
  @ApiOperation({ summary: 'Create a mix playlist from a radio seed' })
  createMix(@Body() dto: CreateMixDto, @CurrentUser() user: JwtPayload) {
    return this.radio.createMix({
      name: dto.name,
      seedTrackId: dto.seed_track_id,
      seedArtistName: dto.seed_artist_name,
      count: dto.count,
      userId: user.sub,
    });
  }
}
