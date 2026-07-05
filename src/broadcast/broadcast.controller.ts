import {
  Controller, Post, Get, Delete, Param, Body, Query, UseGuards, Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { FastifyReply } from 'fastify';
import { BroadcastService } from './broadcast.service';
import { Public } from '../common/decorators/public.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOnly } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/guards/jwt-auth.guard';

class CreateRadioTokenDto {
  @IsOptional() @IsInt() @Min(1) @Max(3650) expires_in_days?: number;
}

@ApiTags('broadcast')
@Controller('api/v1')
export class BroadcastController {
  constructor(private readonly broadcast: BroadcastService) {}

  @Post('playlists/:playlistId/radio-tokens')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a permanent radio stream URL for a playlist' })
  createToken(
    @Param('playlistId') playlistId: string,
    @Body() dto: CreateRadioTokenDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.broadcast.createToken(playlistId, user.sub, user.role === 'admin', dto.expires_in_days);
  }

  @Get('playlists/:playlistId/radio-tokens')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List radio tokens for a playlist' })
  listForPlaylist(@Param('playlistId') playlistId: string, @CurrentUser() user: JwtPayload) {
    return this.broadcast.listForPlaylist(playlistId, user.sub, user.role === 'admin');
  }

  @Delete('playlists/:playlistId/radio-tokens/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a radio token' })
  revoke(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.broadcast.revoke(id, user.sub, user.role === 'admin');
  }

  @Get('admin/radio-tokens')
  @UseGuards(RolesGuard)
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all radio tokens (admin only)' })
  listAll() {
    return this.broadcast.listAll();
  }

  @Delete('admin/radio-tokens/:id')
  @UseGuards(RolesGuard)
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke any radio token (admin only)' })
  adminRevoke(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.broadcast.revoke(id, user.sub, true);
  }

  @Public()
  @Get('broadcast/:token')
  @ApiOperation({ summary: 'Continuous looping stream of a playlist (no auth, token in URL)' })
  @ApiQuery({ name: 'format', required: false, enum: ['mp3', 'aac', 'opus'] })
  @ApiQuery({ name: 'bitrate', required: false, type: Number })
  async stream(
    @Param('token') tokenParam: string,
    @Query('format') formatQuery: string | undefined,
    @Query('bitrate') bitrateQuery: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const dotIdx = tokenParam.lastIndexOf('.');
    let token = tokenParam;
    let format = formatQuery;

    if (dotIdx > 0) {
      const ext = tokenParam.slice(dotIdx + 1).toLowerCase();
      if (['mp3', 'aac', 'opus'].includes(ext)) {
        token = tokenParam.slice(0, dotIdx);
        format = format ?? ext;
      }
    }

    const bitrate = bitrateQuery ? parseInt(bitrateQuery, 10) : 192;
    await this.broadcast.stream(token, format ?? 'mp3', bitrate, reply);
  }
}
