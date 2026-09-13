import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { MusicBrainzModule } from '../musicbrainz/musicbrainz.module';

/**
 * Imports nothing that isn't itself importless. The scanner and the tracks service
 * depend on this for the metadata fill, so anything pulled in here ends up upstream
 * of the library — which is how the chat service (which needs playlists, which need
 * downloads, which need the library) first produced a module cycle. The assistant
 * lives in `AiChatModule` for that reason, and `MusicBrainzModule` qualifies because
 * it reaches nothing but the global database and config.
 */
@Module({
  imports: [MusicBrainzModule],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
