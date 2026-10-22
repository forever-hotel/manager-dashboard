import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { OperationsService } from './operations.service';
import { OperationsController } from './operations.controller';

@Module({
  imports: [AuthModule, RealtimeModule],
  providers: [OperationsService],
  controllers: [OperationsController],
})
export class OperationsModule {}
