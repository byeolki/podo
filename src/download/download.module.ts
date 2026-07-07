import { Module } from '@nestjs/common';
import { DownloadService } from './download.service';
import { DownloadController } from './download.controller';
import { YoutubeService } from './youtube.service';
import { LibraryModule } from '../library/library.module';
import { SyncModule } from '../sync/sync.module';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [LibraryModule, SyncModule, SearchModule],
  providers: [DownloadService, YoutubeService],
  controllers: [DownloadController],
})
export class DownloadModule {}
