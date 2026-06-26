import { Module } from '@nestjs/common';
import { LibraryService } from './library.service';
import { LibraryController } from './library.controller';
import { ScannerService } from './scanner.service';
import { WatcherService } from './watcher.service';
import { FfprobeService } from './ffprobe.service';
import { MetadataService } from './metadata.service';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [SyncModule],
  providers: [LibraryService, ScannerService, WatcherService, FfprobeService, MetadataService],
  controllers: [LibraryController],
  exports: [LibraryService, ScannerService, FfprobeService, MetadataService],
})
export class LibraryModule {}
