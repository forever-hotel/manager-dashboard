import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  HttpCode,
  UnauthorizedException,
} from '@nestjs/common';
import { IsString, Length, Matches } from 'class-validator';
import { AuthService } from './auth.service';

export class LoginDto {
  @IsString() @Length(1, 100) @Matches(/\S/) username!: string;
  @IsString() @Length(1, 1024) password!: string;
}
export class PasswordDto {
  @IsString() @Length(1, 1024) currentPassword!: string;
  @IsString() @Length(1, 1024) newPassword!: string;
}
export function bearer(header?: string) {
  if (!header?.startsWith('Bearer ') || !header.slice(7))
    throw new UnauthorizedException();
  return header.slice(7);
}
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto) {
    return this.auth.login(body);
  }
  @Get('session')
  session(@Headers('authorization') header?: string) {
    return this.auth.session(bearer(header), true);
  }
  @Post('logout')
  @HttpCode(200)
  logout(@Headers('authorization') header?: string) {
    return this.auth.logout(bearer(header));
  }
  @Post('change-password')
  @HttpCode(200)
  changePassword(
    @Body() body: PasswordDto,
    @Headers('authorization') header?: string,
  ) {
    return this.auth.changePassword(bearer(header), body);
  }
}
