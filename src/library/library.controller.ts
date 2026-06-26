import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LibraryService } from './library.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOnly } from '../common/decorators/roles.decorator';

class AddRootDto {
  path!: string;
}

@ApiTags('library')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@AdminOnly()
@Controller('api/v1/library')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get('roots')
  @ApiOperation({ summary: 'List library roots' })
  listRoots() {
    return this.library.listRoots();
  }

  @Post('roots')
  @ApiOperation({ summary: 'Add a library root and start scan' })
  addRoot(@Body() dto: AddRootDto) {
    return this.library.addRoot(dto.path);
  }

  @Delete('roots/:id')
  @ApiOperation({ summary: 'Remove a library root' })
  removeRoot(@Param('id') id: string) {
    return this.library.removeRoot(id);
  }

  @Post('roots/:id/scan')
  @ApiOperation({ summary: 'Trigger manual rescan of a library root' })
  scan(@Param('id') id: string) {
    return this.library.triggerScan(id).then((jobId) => ({ job_id: jobId }));
  }

  @Get('scans')
  @ApiOperation({ summary: 'List scan jobs' })
  listScans() {
    return this.library.listScanJobs();
  }

  @Get('scans/:id')
  @ApiOperation({ summary: 'Get scan job status' })
  getScan(@Param('id') id: string) {
    return this.library.getScanJob(id);
  }
}
