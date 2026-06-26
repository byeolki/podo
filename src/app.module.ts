import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { DatabaseModule } from './db/database.module';
import { AuthModule } from './auth/auth.module';
import { LibraryModule } from './library/library.module';
import { TracksModule } from './tracks/tracks.module';
import { ArtistsModule } from './artists/artists.module';
import { AlbumsModule } from './albums/albums.module';
import { SearchModule } from './search/search.module';
import { StreamingModule } from './streaming/streaming.module';
import { SyncModule } from './sync/sync.module';
import { PlaylistsModule } from './playlists/playlists.module';
import { FavoritesModule } from './favorites/favorites.module';
import { HistoryModule } from './history/history.module';
import { UploadModule } from './upload/upload.module';
import { AdminModule } from './admin/admin.module';
import { HealthController } from './health/health.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    DatabaseModule,
    AuthModule,
    SyncModule,
    LibraryModule,
    TracksModule,
    ArtistsModule,
    AlbumsModule,
    SearchModule,
    StreamingModule,
    PlaylistsModule,
    FavoritesModule,
    HistoryModule,
    UploadModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
