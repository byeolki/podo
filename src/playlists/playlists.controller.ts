import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Req, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsArray, IsInt, IsUrl, Min, Max, MinLength, MaxLength } from 'class-validator';
import { FastifyRequest } from 'fastify';
import { Readable } from 'stream';
import { PlaylistsService } from './playlists.service';
import { PlaylistSyncService } from './playlist-sync.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';

class CreatePlaylistDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsBoolean() is_public?: boolean;
}

class UpdatePlaylistDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsBoolean() is_public?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) track_ids?: string[];
}

class SubscriptionDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) source_url!: string;
  @IsOptional() @IsInt() @Min(15) @Max(10080) interval_minutes?: number;
  @IsOptional() @IsBoolean() audio_only?: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

@ApiTags('playlists')
@ApiBearerAuth()
@Controller('api/v1/playlists')
export class PlaylistsController {
  constructor(
    private readonly playlists: PlaylistsService,
    private readonly sync: PlaylistSyncService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List my playlists' })
  findAll(@CurrentUser() user: JwtPayload) {
    return this.playlists.findAll(user.sub);
  }

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'List all public playlists' })
  findPublic() {
    return this.playlists.findPublic();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get playlist with tracks (public playlists accessible without ownership)' })
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.playlists.findOne(id, user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Create playlist' })
  create(@Body() dto: CreatePlaylistDto, @CurrentUser() user: JwtPayload) {
    return this.playlists.create(dto, user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update playlist name, description, visibility, or track order' })
  update(@Param('id') id: string, @Body() dto: UpdatePlaylistDto, @CurrentUser() user: JwtPayload) {
    return this.playlists.update(id, dto, user.sub);
  }

  @Post(':id/tracks')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Append tracks to playlist' })
  addTracks(@Param('id') id: string, @Body('track_ids') trackIds: string[], @CurrentUser() user: JwtPayload) {
    return this.playlists.addTracks(id, trackIds ?? [], user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete playlist' })
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.playlists.remove(id, user.sub);
  }

  @Post(':id/cover')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a cover image for a playlist' })
  async setCover(@Param('id') id: string, @Req() req: FastifyRequest, @CurrentUser() user: JwtPayload) {
    if (!req.isMultipart()) throw new BadRequestException('Expected multipart/form-data');

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        return this.playlists.setCover(id, part.filename, part.file as unknown as Readable, user.sub);
      }
    }
    throw new BadRequestException('No file provided');
  }

  @Get(':id/subscription')
  @ApiOperation({ summary: 'Get the playlist\'s auto-sync subscription, if any' })
  getSubscription(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.sync.get(id, user.sub, user.role === 'admin');
  }

  @Put(':id/subscription')
  @ApiOperation({ summary: 'Auto-sync this playlist from a remote playlist URL (admin only)' })
  setSubscription(
    @Param('id') id: string,
    @Body() dto: SubscriptionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sync.upsert(id, dto, user.sub, user.role === 'admin');
  }

  @Delete(':id/subscription')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Stop auto-syncing this playlist' })
  removeSubscription(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.sync.remove(id, user.sub, user.role === 'admin');
  }

  @Post(':id/subscription/sync')
  @ApiOperation({ summary: 'Run the subscription now instead of waiting for the interval' })
  runSubscription(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.sync.syncNow(id, user.sub, user.role === 'admin');
  }

  @Delete(':id/cover')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a playlist cover image' })
  removeCover(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.playlists.removeCover(id, user.sub);
  }
}
