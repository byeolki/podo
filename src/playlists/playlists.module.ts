import { Module } from '@nestjs/common';
import { PlaylistsService } from './playlists.service';
import { PlaylistsController } from './playlists.controller';
import { PlaylistSyncService } from './playlist-sync.service';
import { TracksModule } from '../tracks/tracks.module';
import { DownloadModule } from '../download/download.module';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [TracksModule, DownloadModule, SyncModule],
  providers: [PlaylistsService, PlaylistSyncService],
  controllers: [PlaylistsController],
  exports: [PlaylistsService],
})
export class PlaylistsModule {}
