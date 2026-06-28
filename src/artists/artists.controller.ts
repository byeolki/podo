import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsObject, MinLength, MaxLength } from 'class-validator';
import { ArtistsService } from './artists.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/guards/jwt-auth.guard';

class CreateArtistDto {
  @IsString() @MinLength(1) @MaxLength(300) name!: string;
  @IsOptional() @IsBoolean() is_custom?: boolean;
}

class UpdateArtistDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) name?: string;
  @IsOptional() @IsObject() external_ids?: Record<string, string>;
}

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

  @Get(':id')
  @ApiOperation({ summary: 'Get artist with tracks and covers' })
  findOne(@Param('id') id: string) {
    return this.artists.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create custom artist' })
  create(@Body() dto: CreateArtistDto, @CurrentUser() user: JwtPayload) {
    return this.artists.create(dto, user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update artist' })
  update(@Param('id') id: string, @Body() dto: UpdateArtistDto) {
    return this.artists.update(id, dto);
  }
}
