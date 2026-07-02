import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() @MinLength(1) password!: string;
}

export class RegisterDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(128) password!: string;
  @ApiProperty() @IsString() @MinLength(1) invite_token!: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @MinLength(1) refresh_token!: string;
}

export class BootstrapDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(128) password!: string;
}

export class UpdateMeDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() current_password?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MinLength(8) @MaxLength(128) new_password?: string;
}
