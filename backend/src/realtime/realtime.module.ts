import { StockEventsConsumer } from './stock-events.consumer';
import { StockAlertsService } from '../stock/stock-alerts.service';
import { TasksModule } from '../tasks/tasks.module';
import { TaskEventsConsumer } from './task-events.consumer';
import { RoomsModule } from '../rooms/rooms.module';
import { RoomEventsConsumer } from './room-events.consumer';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeController } from './realtime.controller';
import { RealtimeConsumer } from './realtime.consumer';
import { RealtimeGateway } from './realtime.gateway';
import { AnalyticsChangesWorker } from './analytics-changes.worker';
@Module({
  imports: [AuthModule, RoomsModule, TasksModule],
  controllers: [RealtimeController],
  exports: [RealtimeGateway],
  providers: [
    RealtimeGateway,
    AnalyticsChangesWorker,
    StockAlertsService,
    StockEventsConsumer,
    RealtimeConsumer,
    RoomEventsConsumer,
    TaskEventsConsumer
  ]
})
export class RealtimeModule {}
