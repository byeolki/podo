import { Module } from '@nestjs/common';
import { RadioService } from './radio.service';
import { RadioController } from './radio.controller';
import { TracksModule } from '../tracks/tracks.module';

@Module({
  imports: [TracksModule],
  providers: [RadioService],
  controllers: [RadioController],
})
export class RadioModule {}
