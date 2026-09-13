import { Module } from '@nestjs/common';
import { MusicBrainzService } from './musicbrainz.service';

/**
 * Importless, like `AiModule` and for the same reason: the AI metadata fill sits
 * upstream of the library, so anything this pulled in would be dragged upstream
 * with it. It needs only the global database and config modules.
 */
@Module({
  providers: [MusicBrainzService],
  exports: [MusicBrainzService],
})
export class MusicBrainzModule {}
