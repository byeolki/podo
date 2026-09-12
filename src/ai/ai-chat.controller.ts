import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AiChatService, ChatMessage } from './ai-chat.service';
import { AiService } from './ai.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/guards/jwt-auth.guard';

class ChatMessageDto {
  @IsIn(['user', 'assistant']) role!: 'user' | 'assistant';
  @IsString() @MaxLength(4000) content!: string;
}

class ChatDto {
  // Only the last few turns are used; validating an unbounded array first is
  // free CPU for anyone who asks for it.
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller('api/v1/ai')
export class AiChatController {
  constructor(
    private readonly chat: AiChatService,
    private readonly ai: AiService,
  ) {}

  /**
   * What the client may offer. Open to any signed-in user, unlike the settings
   * that control it — this says only whether each feature is on, never which
   * provider or model, and never a key.
   *
   * Two flags, not one: AI Fill is available to every user whenever a provider
   * works, while the assistant is a separate switch. Collapsing them meant the
   * AI Fill button was hidden whenever the assistant happened to be off.
   */
  @Get('status')
  @ApiOperation({ summary: 'Which AI features are available to this user' })
  async status() {
    return {
      available: await this.ai.isUsable(),
      chat_enabled: await this.ai.isChatEnabled(),
    };
  }

  @Post('chat')
  @ApiOperation({ summary: 'Ask the assistant. It can search, queue and manage your playlists.' })
  send(@Body() dto: ChatDto, @CurrentUser() user: JwtPayload) {
    return this.chat.chat(dto.messages as ChatMessage[], user.sub);
  }
}
