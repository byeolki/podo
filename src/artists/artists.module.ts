import { Module } from '@nestjs/common';
import { ArtistsService } from './artists.service';
import { ArtistsController } from './artists.controller';
import { TracksModule } from '../tracks/tracks.module';

@Module({
  imports: [TracksModule],
  providers: [ArtistsService],
  controllers: [ArtistsController],
  exports: [ArtistsService],
})
export class ArtistsModule {}
