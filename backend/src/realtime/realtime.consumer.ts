import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isISO8601, isUUID } from 'class-validator';
import { connect, ChannelModel, Channel } from 'amqplib';
import { DataSource } from 'typeorm';
import { KitchenEvent, RealtimeGateway } from './realtime.gateway';

export function parseKitchenEvent(raw: unknown): KitchenEvent {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid event');
  const e = raw as Record<string, unknown>;
  if (
    e.type !== 'kitchen.order.changed' ||
    typeof e.eventId !== 'string' ||
    !isUUID(e.eventId) ||
    typeof e.orderId !== 'string' ||
    !isUUID(e.orderId) ||
    !Number.isSafeInteger(e.version) ||
    Number(e.version) < 0 ||
    typeof e.occurredAt !== 'string' ||
    !isISO8601(e.occurredAt, { strict: true }) ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(e.occurredAt)
  )
    throw new Error('Invalid event');
  return {
    eventId: e.eventId,
    type: e.type,
    orderId: e.orderId,
    version: Number(e.version),
    occurredAt: e.occurredAt,
  };
}
@Injectable()
export class RealtimeConsumer implements OnModuleInit, OnModuleDestroy {
  private connection?: ChannelModel;
  private channel?: Channel;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private busy = false;
  constructor(
    private readonly config: ConfigService,
    private readonly database: DataSource,
    private readonly gateway: RealtimeGateway,
  ) {}
  onModuleInit() {
    if (this.config.get<string>('MAD_REALTIME_ENABLED') === 'true')
      void this.tick();
  }
  async accept(event: KitchenEvent) {
    await this.database.transaction(async (manager) => {
      // Transaction-level lock serializes versions for one order across consumers.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [event.orderId],
      );
      const [seen] = await manager.query<{ exists: boolean }[]>(
        'SELECT EXISTS(SELECT 1 FROM mad_realtime_events WHERE event_id=$1) AS exists',
        [event.eventId],
      );
      if (seen.exists) return;
      const [last] = await manager.query<{ version: string }[]>(
        'SELECT version FROM mad_realtime_versions WHERE order_id=$1',
        [event.orderId],
      );
      const stale = last && Number(last.version) >= event.version;
      await manager.query(
        'INSERT INTO mad_realtime_events(event_id,order_id,version,payload,delivered_at) VALUES ($1,$2,$3,$4,CASE WHEN $5 THEN now() ELSE NULL END)',
        [
          event.eventId,
          event.orderId,
          event.version,
          JSON.stringify(event),
          Boolean(stale),
        ],
      );
      if (!stale)
        await manager.query(
          'INSERT INTO mad_realtime_versions(order_id,version) VALUES ($1,$2) ON CONFLICT(order_id) DO UPDATE SET version=EXCLUDED.version',
          [event.orderId, event.version],
        );
    });
  }
  private async attach() {
    const url = this.config.get<string>('RABBITMQ_URL');
    if (!url) throw new Error('Missing broker');
    const connection = await connect(url, { timeout: 5000 });
    if (this.stopped) {
      await connection.close();
      throw new Error('Stopped');
    }
    this.connection = connection;
    connection.on('error', () => {
      this.gateway.healthy = false;
    });
    connection.on('close', () => {
      if (this.connection === connection) {
        this.connection = undefined;
        this.channel = undefined;
        this.gateway.healthy = false;
      }
    });
    const channel = await connection.createChannel();
    this.channel = channel;
    channel.on('error', () => {
      this.gateway.healthy = false;
    });
    channel.on('close', () => {
      if (this.channel === channel) {
        this.channel = undefined;
        this.gateway.healthy = false;
      }
    });
    await channel.assertExchange('hotel.events', 'topic', { durable: true });
    await channel.assertQueue('mad.kitchen.dead', { durable: true });
    await channel.assertQueue('mad.kitchen', {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': 'mad.kitchen.dead',
      },
    });
    await channel.bindQueue(
      'mad.kitchen',
      'hotel.events',
      'kitchen.order.changed',
    );
    await channel.prefetch(1);
    await channel.consume(
      'mad.kitchen',
      (message) => {
        if (!message) {
          this.gateway.healthy = false;
          void connection.close().catch(() => undefined);
          return;
        }
        let event: KitchenEvent;
        try {
          if (message.content.length > 8192) throw new Error();
          event = parseKitchenEvent(
            JSON.parse(message.content.toString()) as unknown,
          );
        } catch {
          channel.nack(message, false, false);
          return;
        }
        void this.accept(event)
          .then(
            () => {
              channel.ack(message);
            },
            () => {
              // Closing requeues unacknowledged delivery without a tight retry loop.
              this.gateway.healthy = false;
              void connection.close().catch(() => undefined);
            },
          )
          .catch(() => {
            this.gateway.healthy = false;
          });
      },
      { noAck: false },
    );
  }
  async dispatch() {
    const rows = await this.database.query<
      { event_id: string; payload: KitchenEvent }[]
    >(
      'SELECT event_id,payload FROM mad_realtime_events WHERE delivered_at IS NULL ORDER BY received_at,event_id LIMIT 100',
    );
    for (const row of rows) {
      await this.gateway.publish(row.payload);
      await this.database.query(
        'UPDATE mad_realtime_events SET delivered_at=now() WHERE event_id=$1',
        [row.event_id],
      );
    }
  }
  private async tick() {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      if (!this.channel) {
        await this.connection?.close().catch(() => undefined);
        await this.attach();
      }
      await this.dispatch();
      this.gateway.healthy = Boolean(this.channel);
    } catch {
      this.gateway.healthy = false;
      await this.connection?.close().catch(() => undefined);
      this.connection = undefined;
      this.channel = undefined;
    } finally {
      this.busy = false;
      if (!this.stopped) {
        this.timer = setTimeout(
          () => {
            void this.tick();
          },
          this.gateway.healthy ? 250 : 5000,
        );
        this.timer.unref();
      }
    }
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.connection?.close().catch(() => undefined);
  }
}
