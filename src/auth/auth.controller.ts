import { Controller, Post, Get, Patch, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, RefreshDto, BootstrapDto, UpdateMeDto } from './auth.dto';
import { Public } from '../common/decorators/public.decorator';
import { AdminOnly } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthThrottleGuard } from '../common/guards/auth-throttle.guard';
import { JwtPayload } from '../common/guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(AuthThrottleGuard)
  @Post('bootstrap')
  @ApiOperation({ summary: 'Create the first admin user (only if no users exist)' })
  bootstrap(@Body() dto: BootstrapDto) {
    return this.auth.bootstrapAdmin(dto);
  }

  @Public()
  @UseGuards(AuthThrottleGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login and receive tokens' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @UseGuards(AuthThrottleGuard)
  @Post('register')
  @ApiOperation({ summary: 'Register with invite token' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @UseGuards(AuthThrottleGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange refresh token for new token pair' })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refresh_token);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke refresh token' })
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refresh_token);
  }

  @UseGuards(RolesGuard)
  @AdminOnly()
  @Post('invite')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate an invite token (admin only)' })
  invite(@CurrentUser() user: JwtPayload) {
    return this.auth.createInvite(user.sub).then((token) => ({ invite_token: token }));
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user account info' })
  getMe(@CurrentUser() user: JwtPayload) {
    return this.auth.getMe(user.sub);
  }

  @Patch('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update own name and/or password' })
  updateMe(@Body() dto: UpdateMeDto, @CurrentUser() user: JwtPayload) {
    return this.auth.updateMe(user.sub, dto);
  }
}
