import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class NotificationsWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = false;
  private previous?: string;

  constructor(
    private readonly notifications: NotificationsService,
    private readonly gateway: RealtimeGateway
  ) {}

  async tick() {
    try {
      const revision = await this.notifications.fingerprint();

      if (this.previous !== revision) {
        await this.gateway.send('notifications.changed', {
          revision,
          occurredAt: new Date().toISOString()
        });
        this.previous = revision;
      }
      this.gateway.notificationsHealthy = true;
    } catch {
      this.gateway.notificationsHealthy = false;
    }
  }

  onApplicationBootstrap() {
    const poll = () => {
      this.running = this.tick().finally(() => {
        if (!this.stopped) {
          this.timer = setTimeout(poll, 1000);
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
