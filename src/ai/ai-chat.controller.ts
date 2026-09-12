import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsArray, IsIn, IsString, MaxLength, ValidateNested } from 'class-validator';
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
  @IsArray() @ValidateNested({ each: true }) @Type(() => ChatMessageDto)
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
   * Whether to show the assistant at all. Open to any signed-in user, unlike the
   * settings that control it — the client needs this to decide whether to render
   * the launcher, and it says nothing beyond on/off.
   */
  @Get('status')
  @ApiOperation({ summary: 'Whether the assistant is available to this user' })
  async status() {
    return { enabled: await this.ai.isChatEnabled() };
  }

  @Post('chat')
  @ApiOperation({ summary: 'Ask the assistant. It can search, queue and manage your playlists.' })
  send(@Body() dto: ChatDto, @CurrentUser() user: JwtPayload) {
    return this.chat.chat(dto.messages as ChatMessage[], user.sub);
  }
}
