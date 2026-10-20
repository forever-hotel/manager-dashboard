import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeController } from './realtime.controller';
import { RealtimeConsumer } from './realtime.consumer';
import { RealtimeGateway } from './realtime.gateway';
@Module({
  imports: [AuthModule],
  controllers: [RealtimeController],
  providers: [RealtimeGateway, RealtimeConsumer],
})
export class RealtimeModule {}
