import { Module } from '@nestjs/common';
import { DownloadService } from './download.service';
import { DownloadController } from './download.controller';
import { LibraryModule } from '../library/library.module';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [LibraryModule, SyncModule],
  providers: [DownloadService],
  controllers: [DownloadController],
})
export class DownloadModule {}
