import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { AdminOnly } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminService } from '../admin/admin.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly admin: AdminService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Health check endpoint (Docker healthcheck)' })
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  // Exposes uptime, memory and row counts — admin-only, unlike the bare `/health`
  // liveness probe above, which deliberately says nothing about the deployment.
  @UseGuards(RolesGuard)
  @AdminOnly()
  @ApiBearerAuth()
  @Get('api/v1/admin/health/detail')
  @ApiOperation({ summary: 'Detailed system health (admin)' })
  detail() {
    return this.admin.getSystemHealth();
  }
}
