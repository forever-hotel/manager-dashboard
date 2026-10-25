import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { DependencyState, operationsTelemetry } from './operations.telemetry';

@Injectable()
export class OperationsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = false;
  private databaseState: DependencyState = 'unavailable';
  private lastProbeAt: string | null = null;
  constructor(
    @InjectDataSource() private readonly database: DataSource,
    private readonly gateway: RealtimeGateway,
    private readonly config: ConfigService
  ) {}
  status() {
    const live = this.config.get<string>('MAD_REALTIME_ENABLED') === 'true';
    const source = (healthy: boolean): DependencyState => (!live ? 'disabled' : healthy ? 'healthy' : 'unavailable');
    const checks: Record<string, DependencyState> = {
      database: this.databaseState,
      kitchenEvents: source(this.gateway.healthy),
      roomEvents: source(this.gateway.roomsHealthy),
      taskEvents: source(this.gateway.tasksHealthy),
      stockEvents: source(this.gateway.stockHealthy),
      notifications: this.gateway.notificationsHealthy ? 'healthy' : 'unavailable',
      auditEmitter: operationsTelemetry.snapshot().auditWriteFailures === 0 ? 'healthy' : 'unavailable'
    };
    return {
      status: Object.values(checks).includes('unavailable') ? 'degraded' : 'ok',
      service: 'mad-backend',
      observedAt: new Date().toISOString(),
      databaseCheckedAt: this.lastProbeAt,
      checks,
      metrics: operationsTelemetry.snapshot()
    };
  }
  async tick() {
    try {
      await this.database.query('SELECT 1');
      this.databaseState = 'healthy';
    } catch {
      this.databaseState = 'unavailable';
    }
    this.lastProbeAt = new Date().toISOString();
    operationsTelemetry.dependencies(this.status().checks);
  }
  onApplicationBootstrap() {
    const poll = () => {
      this.running = this.tick().finally(() => {
        if (!this.stopped) {
          this.timer = setTimeout(poll, 10000);
          this.timer.unref();
        }
      });
    };
    poll();
  }
  async onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
}
