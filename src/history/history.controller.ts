import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, IsISO8601, Min } from 'class-validator';
import { HistoryService } from './history.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/guards/jwt-auth.guard';

class RecordPlayDto {
  @IsString() track_id!: string;
  @IsOptional() @IsString() source_id?: string;
  @IsISO8601() played_at!: string;
  @IsInt() @Min(0) played_duration!: number;
}

@ApiTags('history')
@ApiBearerAuth()
@Controller('api/v1')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get('history')
  @ApiOperation({ summary: 'Get recent play history' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getRecent(@CurrentUser() user: JwtPayload, @Query('limit') limit?: string) {
    return this.history.getRecent(user.sub, limit ? parseInt(limit, 10) : 50);
  }

  @Post('history')
  @ApiOperation({ summary: 'Record a play event' })
  record(@Body() dto: RecordPlayDto, @CurrentUser() user: JwtPayload) {
    return this.history.record({
      userId: user.sub,
      trackId: dto.track_id,
      sourceId: dto.source_id,
      playedAt: new Date(dto.played_at),
      playedDuration: dto.played_duration,
    });
  }

  @Get('stats/me')
  @ApiOperation({ summary: 'Get my listening stats' })
  @ApiQuery({ name: 'period', required: false, enum: ['week', 'month', 'all'] })
  getStats(@CurrentUser() user: JwtPayload, @Query('period') period?: 'week' | 'month' | 'all') {
    return this.history.getStats(user.sub, period ?? 'all');
  }
}
