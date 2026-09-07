import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UpdateService } from './update.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOnly } from '../common/decorators/roles.decorator';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@AdminOnly()
@Controller('api/v1/admin/update')
export class UpdateController {
  constructor(private readonly update: UpdateService) {}

  @Get()
  @ApiOperation({ summary: 'Whether a newer Podo release is available (admin only)' })
  status() {
    return this.update.getStatus();
  }

  @Post('check')
  @ApiOperation({ summary: 'Re-check now, ignoring the cached result (admin only)' })
  recheck() {
    return this.update.getStatus(true);
  }
}
