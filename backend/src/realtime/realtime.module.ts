import { RoomsModule } from '../rooms/rooms.module';
import { RoomEventsConsumer } from './room-events.consumer';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeController } from './realtime.controller';
import { RealtimeConsumer } from './realtime.consumer';
import { RealtimeGateway } from './realtime.gateway';
@Module({
  imports: [AuthModule, RoomsModule],
  controllers: [RealtimeController],
  providers: [RealtimeGateway, RealtimeConsumer, RoomEventsConsumer],
})
export class RealtimeModule {}
