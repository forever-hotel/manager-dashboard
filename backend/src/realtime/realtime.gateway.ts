import type { StockUpdate } from '../stock/stock-event';
import type { TaskEvent } from './task-events.consumer';
import type { RoomEvent } from './room-events.consumer';
import { Injectable, OnModuleInit, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib';
import { REALTIME_EXCHANGE, eventChannels } from '../shared-websocket/contracts';

export interface KitchenEvent {
  eventId: string;
  type: 'kitchen.order.changed';
  orderId: string;
  version: number;
  occurredAt: string;
}
// MAD's source consumers retain durable validation/inboxes; browser sockets live in the shared service.
@Injectable()
export class RealtimeGateway implements OnModuleInit, OnModuleDestroy {
  healthy = false;
  roomsHealthy = false;
  tasksHealthy = false;
  stockHealthy = false;
  notificationsHealthy = false;
  analyticsHealthy = false;
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private attaching?: Promise<ConfirmChannel>;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private sending = false;

  constructor(private readonly config: ConfigService) {}

  async ticket(token: string) {
    try {
      const base = this.config.get<string>('SHARED_WEBSOCKET_URL');
      const key = this.config.get<string>('MAD_WEBSOCKET_RELAY_KEY');

      if (!base || !key) throw new Error();
      const result = await fetch(new URL('/internal/tickets/mad', base), {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'x-relay-key': key },
        signal: AbortSignal.timeout(5000),
        redirect: 'error'
      });

      if (!result.ok) throw new Error();
      const body = (await result.json()) as { ticket?: unknown; expiresIn?: unknown };

      if (typeof body.ticket !== 'string' || !/^[\w-]{43}$/.test(body.ticket) || body.expiresIn !== 30)
        throw new Error();
      return { ticket: body.ticket, expiresIn: 30 };
    } catch {
      throw new ServiceUnavailableException();
    }
  }

  onModuleInit() {
    if (this.config.get<string>('MAD_REALTIME_ENABLED') !== 'true') return;
    this.timer = setInterval(() => {
      if (this.sending) return;
      this.sending = true;
      void Promise.all([
        this.send('transport.status', { healthy: this.healthy }),
        this.send('rooms.transport.status', { healthy: this.roomsHealthy }),
        this.send('tasks.transport.status', { healthy: this.tasksHealthy }),
        this.send('stock.transport.status', { healthy: this.stockHealthy }),
        this.send('notifications.transport.status', { healthy: this.notificationsHealthy }),
        this.send('analytics.transport.status', { healthy: this.analyticsHealthy })
      ])
        .catch(() => undefined)
        .finally(() => {
          this.sending = false;
        });
    }, 5000);
    this.timer.unref();
  }

  private async attach(): Promise<ConfirmChannel> {
    const connection = await connect(this.config.getOrThrow<string>('RABBITMQ_URL'), { timeout: 5000 });

    this.connection = connection;
    const reset = () => {
      this.channel = undefined;
    };

    connection.on('error', reset);
    connection.on('close', reset);
    try {
      const channel = await connection.createConfirmChannel();

      channel.on('error', reset);
      channel.on('close', () => {
        reset();
        void connection.close().catch(() => undefined);
      });
      await channel.assertExchange(REALTIME_EXCHANGE, 'topic', { durable: true });
      await channel.assertQueue('shared.websocket', {
        durable: true,
        arguments: { 'x-message-ttl': 60000, 'x-max-length': 10000 }
      });
      await channel.bindQueue('shared.websocket', REALTIME_EXCHANGE, '#');
      if (this.stopped) {
        await connection.close();
        throw new Error('Stopped');
      }
      this.channel = channel;
      return channel;
    } catch (error) {
      await connection.close().catch(() => undefined);
      throw error;
    }
  }

  async send(name: string, data: unknown) {
    if (!eventChannels[name] || this.stopped) throw new ServiceUnavailableException();
    if (!this.channel) {
      this.attaching ??= this.attach().finally(() => {
        this.attaching = undefined;
      });
      await this.attaching;
    }
    const channel = this.channel;

    if (!channel) throw new ServiceUnavailableException();
    const healthy = typeof data === 'object' && data !== null && 'healthy' in data && data.healthy === true;

    await new Promise<void>((resolve, reject) =>
      channel.publish(
        REALTIME_EXCHANGE,
        'mad.' + name,
        Buffer.from(
          JSON.stringify({ subsystem: 'mad', name, ...(name.endsWith('transport.status') ? { healthy } : {}) })
        ),
        { persistent: true, contentType: 'application/json', expiration: '60000' },
        error => (error ? reject(error instanceof Error ? error : new Error('Realtime publish failed')) : resolve())
      )
    );
  }

  async publish(event: KitchenEvent) {
    await this.send('kitchen.order.changed', event);
    await this.send('food.analytics.changed', event);
  }

  async publishRoom(event: RoomEvent) {
    await this.send('room.status.changed', event);
    await this.send('analytics.changed', event);
  }

  async publishTask(event: TaskEvent) {
    await this.send('task.changed', event);
  }

  async publishStock(event: StockUpdate) {
    await this.send('stock.alert.changed', event);
  }

  async onModuleDestroy() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.connection?.close().catch(() => undefined);
  }
}
