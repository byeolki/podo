import { Controller, Get, Post, Patch, Delete, Param, Body, Req, HttpCode, HttpStatus, ParseArrayPipe, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsArray, IsUUID, MinLength, MaxLength } from 'class-validator';
import { FastifyRequest } from 'fastify';
import { Readable } from 'stream';
import { PlaylistsService } from './playlists.service';
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

@ApiTags('playlists')
@ApiBearerAuth()
@Controller('api/v1/playlists')
export class PlaylistsController {
  constructor(private readonly playlists: PlaylistsService) {}

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

  @Delete(':id/cover')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a playlist cover image' })
  removeCover(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.playlists.removeCover(id, user.sub);
  }
}
