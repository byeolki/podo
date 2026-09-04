import { Module } from '@nestjs/common';
import { AlbumsService } from './albums.service';
import { AlbumsController } from './albums.controller';
import { TracksModule } from '../tracks/tracks.module';

@Module({
  imports: [TracksModule],
  providers: [AlbumsService],
  controllers: [AlbumsController],
  exports: [AlbumsService],
})
export class AlbumsModule {}
