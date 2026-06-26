import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
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

  @Get('api/v1/admin/health/detail')
  @ApiOperation({ summary: 'Detailed system health (admin)' })
  detail() {
    return this.admin.getSystemHealth();
  }
}
