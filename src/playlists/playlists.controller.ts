import { Controller, Get, Post, Patch, Delete, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsArray, IsUUID, MinLength, MaxLength } from 'class-validator';
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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete playlist' })
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.playlists.remove(id, user.sub);
  }
}
