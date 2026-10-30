import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { InitialManagerService } from './initial-manager.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, InitialManagerService],
  exports: [AuthService, JwtAuthGuard]
})
export class AuthModule {}
