import { Module } from '@nestjs/common';
import { AiService } from './ai.service';

/**
 * Deliberately importless. The scanner and the tracks service depend on this for
 * the metadata fill, so anything imported here ends up upstream of the library —
 * which is how the chat service (which needs playlists, which need downloads,
 * which need the library) first produced a module cycle. The assistant lives in
 * `AiChatModule` for that reason.
 */
@Module({
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
