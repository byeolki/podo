import { Body, Controller, Logger, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/guards/jwt-auth.guard';

class ClientErrorDto {
  @IsIn(['ios', 'macos', 'web']) platform!: 'ios' | 'macos' | 'web';
  @IsString() @MaxLength(200) kind!: string;
  @IsString() @MaxLength(2000) message!: string;
  /** Where it happened — a track id, a URL path, a screen. Never a token. */
  @IsOptional() @IsString() @MaxLength(500) context?: string;
  @IsOptional() @IsString() @MaxLength(40) app_version?: string;
}

/**
 * Somewhere for a client to say that something went wrong.
 *
 * A failure on a phone is invisible here otherwise, which is why "it stops
 * playing sometimes" took a day of guessing: the one machine that saw the error
 * had no way to say so. This puts it in the server log next to the request that
 * caused it.
 *
 * Deliberately a log line rather than a table. The operator already reads these
 * logs, nothing here needs querying later, and a table would be one more thing
 * growing without a reason to.
 */
@ApiTags('telemetry')
@ApiBearerAuth()
@Controller('api/v1/client-errors')
export class ClientErrorsController {
  private readonly logger = new Logger('ClientError');

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Report a client-side failure so it lands in the server log' })
  report(@Body() dto: ClientErrorDto, @CurrentUser() user: JwtPayload): void {
    const where = dto.context ? ` @ ${dto.context}` : '';
    const version = dto.app_version ? ` v${dto.app_version}` : '';
    this.logger.warn(`[${dto.platform}${version}] ${dto.kind}: ${dto.message}${where} (user ${user.sub})`);
  }
}
