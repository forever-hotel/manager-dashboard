import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TaskLimitController } from './task-limit.controller';
import { TaskLimitService } from './task-limit.service';
@Module({
  imports: [AuthModule],
  controllers: [TaskLimitController],
  providers: [TaskLimitService],
})
export class SettingsModule {}
