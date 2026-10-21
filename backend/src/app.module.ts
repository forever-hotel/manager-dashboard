import { ReportsModule } from './reports/reports.module';
import { SettingsModule } from './settings/settings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PromotionsModule } from './promotions/promotions.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { validateEnvironment } from './config/environment';
import { AnalyticsModule } from './analytics/analytics.module';
import { StaffModule } from './staff/staff.module';
import { ComplaintsModule } from './complaints/complaints.module';
import { TasksModule } from './tasks/tasks.module';
import { RoomsModule } from './rooms/rooms.module';
import { KitchenModule } from './kitchen/kitchen.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnvironment,
    }),
    DatabaseModule,
    AuthModule,
    AnalyticsModule,
    ReportsModule,
    SettingsModule,
    NotificationsModule,
    StaffModule,
    PromotionsModule,
    ComplaintsModule,
    KitchenModule,
    RoomsModule,
    TasksModule,
    RealtimeModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
