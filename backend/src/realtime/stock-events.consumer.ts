import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  connect,
  type ChannelModel,
  type Channel,
  type ConsumeMessage,
} from 'amqplib';
import { DataSource } from 'typeorm';
import { RealtimeGateway } from './realtime.gateway';
import { StockAlertsService } from '../stock/stock-alerts.service';
import {
  InvalidStockEvent,
  parseStockEvent,
  type StockUpdate,
} from '../stock/stock-event';
export const STOCK_QUEUE = 'mad.stock';
export const STOCK_DEAD_QUEUE = 'mad.stock.dead';
export const STOCK_BINDING = 'kitchen.stock.changed';
export const STOCK_RETRY_DELAY = 5000;
export const STOCK_QUEUE_ARGUMENTS = {
  'x-queue-type': 'quorum',
  'x-delivery-limit': 5,
  'x-dead-letter-exchange': '',
  'x-dead-letter-routing-key': STOCK_DEAD_QUEUE,
  'x-dead-letter-strategy': 'at-least-once',
  'x-overflow': 'reject-publish',
};
@Injectable()
export class StockEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StockEventsConsumer.name);
  private connection?: ChannelModel;
  private channel?: Channel;
  private timer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private busy = false;
  constructor(
    private readonly config: ConfigService,
    private readonly database: DataSource,
    private readonly gateway: RealtimeGateway,
    private readonly alerts: StockAlertsService,
  ) {}
  onModuleInit() {
    if (this.config.get<string>('MAD_REALTIME_ENABLED') === 'true')
      void this.tick();
  }
  private offline() {
    this.gateway.stockHealthy = false;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
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
      if (this.connection === connection) {
        this.offline();
        void connection.close().catch(() => undefined);
      }
    });
    connection.on('close', () => {
      if (this.connection === connection) {
        this.connection = undefined;
        this.channel = undefined;
        this.offline();
      }
    });
    const channel = await connection.createChannel();
    this.channel = channel;
    channel.on('error', () => {
      if (this.channel === channel) {
        this.offline();
        void connection.close().catch(() => undefined);
      }
    });
    channel.on('close', () => {
      if (this.channel === channel) {
        this.channel = undefined;
        this.offline();
      }
    });
    await channel.assertExchange('hotel.events', 'topic', { durable: true });
    await channel.assertQueue(STOCK_DEAD_QUEUE, {
      durable: true,
      arguments: { 'x-queue-type': 'quorum', 'x-delivery-limit': -1 },
    });
    await channel.assertQueue(STOCK_QUEUE, {
      durable: true,
      arguments: STOCK_QUEUE_ARGUMENTS,
    });
    await channel.bindQueue(STOCK_QUEUE, 'hotel.events', STOCK_BINDING);
    await channel.prefetch(1);
    await channel.consume(
      STOCK_QUEUE,
      (message) => {
        if (!message) {
          this.offline();
          void connection.close().catch(() => undefined);
          return;
        }
        void this.handle(channel, connection, message);
      },
      { noAck: false },
    );
  }
  private async handle(
    channel: Channel,
    connection: ChannelModel,
    message: ConsumeMessage,
  ) {
    try {
      if (message.content.length > 8192)
        throw new InvalidStockEvent('Oversized stock event');
      let raw: unknown;
      try {
        raw = JSON.parse(message.content.toString()) as unknown;
      } catch {
        throw new InvalidStockEvent('Malformed stock event');
      }
      const event = parseStockEvent(raw);
      await this.alerts.accept(event);
      // Durable alert and notification outbox are committed before acknowledgement.
      if (!this.stopped && this.channel === channel) channel.ack(message);
    } catch (error) {
      if (this.stopped || this.channel !== channel) return;
      if (error instanceof InvalidStockEvent) {
        this.logger.warn({
          event: 'stock.event_dead_lettered',
          reason: 'invalid_contract',
        });
        try {
          channel.reject(message, false);
        } catch {
          void connection.close().catch(() => undefined);
        }
        return;
      }
      this.gateway.stockHealthy = false;
      this.logger.warn({
        event: 'stock.event_retry',
        reason: 'processing_failure',
      });
      // Quorum delivery-limit is broker-persisted, including consumer crashes/restarts.
      // basic.reject marks a failure; basic.nack does not do so in RabbitMQ 4.3+.
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        if (!this.stopped && this.channel === channel) {
          try {
            channel.reject(message, true);
          } catch {
            void connection.close().catch(() => undefined);
          }
        }
      }, STOCK_RETRY_DELAY);
      this.retryTimer.unref();
    }
  }
  async dispatch() {
    const rows = await this.database.query<
      { event_id: string; payload: StockUpdate }[]
    >(
      "SELECT e.event_id,e.payload FROM mad_stock_events e JOIN mad_stock_alerts a ON a.menu_item_id=e.menu_item_id AND a.version=e.version WHERE e.delivery_state='pending' ORDER BY e.received_at,e.event_id LIMIT 100",
    );
    for (const row of rows) {
      await this.gateway.publishStock(row.payload);
      await this.database.query(
        "UPDATE mad_stock_events SET delivery_state='published',published_at=now() WHERE event_id=$1 AND delivery_state='pending'",
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
      this.gateway.stockHealthy = Boolean(this.channel) && !this.retryTimer;
    } catch {
      this.gateway.stockHealthy = false;
      await this.connection?.close().catch(() => undefined);
      this.connection = undefined;
      this.channel = undefined;
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    } finally {
      this.busy = false;
      if (!this.stopped) {
        this.timer = setTimeout(
          () => void this.tick(),
          this.gateway.stockHealthy ? 250 : 5000,
        );
        this.timer.unref();
      }
    }
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.offline();
    await this.connection?.close().catch(() => undefined);
  }
}
