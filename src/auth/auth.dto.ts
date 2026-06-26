import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty() email!: string;
  @ApiProperty() password!: string;
}

export class RegisterDto {
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty() password!: string;
  @ApiProperty() invite_token!: string;
}

export class RefreshDto {
  @ApiProperty() refresh_token!: string;
}

export class BootstrapDto {
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty() password!: string;
}
