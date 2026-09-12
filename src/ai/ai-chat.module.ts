import { Module } from '@nestjs/common';
import { AiModule } from './ai.module';
import { AiChatService } from './ai-chat.service';
import { AiChatController } from './ai-chat.controller';
import { SearchModule } from '../search/search.module';
import { PlaylistsModule } from '../playlists/playlists.module';

@Module({
  imports: [AiModule, SearchModule, PlaylistsModule],
  providers: [AiChatService],
  controllers: [AiChatController],
})
export class AiChatModule {}
