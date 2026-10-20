import { EventEmitter } from 'node:events';
import {
  connect,
  type ChannelModel,
  type Channel,
  type ConsumeMessage,
} from 'amqplib';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  StockEventsConsumer,
  STOCK_QUEUE_ARGUMENTS,
  STOCK_RETRY_DELAY,
} from './stock-events.consumer';
import { StockAlertsService } from '../stock/stock-alerts.service';
import { InvalidStockEvent } from '../stock/stock-event';
import { RealtimeGateway } from './realtime.gateway';
jest.mock('amqplib', () => ({ connect: jest.fn() }));
const event = {
  eventId: '67f4568c-89ab-4c12-b321-123456789012',
  menuItemId: '77f4568c-89ab-4c12-b321-123456789012',
  type: 'kitchen.stock.changed',
  stockStatus: 'LOW_STOCK',
  version: 2,
  occurredAt: '2026-10-21T00:00:00Z',
};
describe('DDP-034 durable stock broker lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(connect).mockReset();
  });
  afterEach(() => jest.useRealTimers());
  function setup() {
    const channel = Object.assign(new EventEmitter(), {
      assertExchange: jest.fn().mockResolvedValue({}),
      assertQueue: jest.fn().mockResolvedValue({}),
      bindQueue: jest.fn().mockResolvedValue({}),
      prefetch: jest.fn().mockResolvedValue({}),
      consume: jest
        .fn<
          Promise<{ consumerTag: string }>,
          [string, (message: ConsumeMessage | null) => void, { noAck: boolean }]
        >()
        .mockResolvedValue({ consumerTag: 'test' }),
      ack: jest.fn(),
      reject: jest.fn(),
    });
    const connection = Object.assign(new EventEmitter(), {
      createChannel: jest.fn().mockResolvedValue(channel as unknown as Channel),
      close: jest.fn().mockResolvedValue(undefined),
    });
    jest
      .mocked(connect)
      .mockResolvedValue(connection as unknown as ChannelModel);
    const config = new ConfigService({
      MAD_REALTIME_ENABLED: 'true',
      RABBITMQ_URL: 'amqp://localhost/mad_test',
    });
    const query = jest.fn().mockResolvedValue([]);
    const gateway = {
      stockHealthy: false,
      publishStock: jest.fn().mockResolvedValue(undefined),
    };
    const accept = jest.fn().mockResolvedValue(undefined);
    const consumer = new StockEventsConsumer(
      config,
      { query } as unknown as DataSource,
      gateway as unknown as RealtimeGateway,
      { accept } as unknown as StockAlertsService,
    );
    return { channel, connection, config, query, gateway, accept, consumer };
  }
  const message = () =>
    ({ content: Buffer.from(JSON.stringify(event)) }) as ConsumeMessage;
  it('declares quorum retry/DLQ routing and acknowledges only after durable processing', async () => {
    const { consumer, channel, accept } = setup();
    let finish!: () => void;
    accept.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    consumer.onModuleInit();
    await jest.advanceTimersByTimeAsync(1);
    try {
      expect(channel.assertQueue).toHaveBeenCalledWith('mad.stock', {
        durable: true,
        arguments: STOCK_QUEUE_ARGUMENTS,
      });
      expect(STOCK_QUEUE_ARGUMENTS['x-delivery-limit']).toBe(5);
      expect(channel.assertQueue).toHaveBeenCalledWith('mad.stock.dead', {
        durable: true,
        arguments: { 'x-queue-type': 'quorum', 'x-delivery-limit': -1 },
      });
      expect(channel.prefetch).toHaveBeenCalledWith(1);
      const receive = channel.consume.mock.calls[0][1];
      const msg = message();
      receive(msg);
      await jest.advanceTimersByTimeAsync(1);
      expect(channel.ack).not.toHaveBeenCalled();
      finish();
      await jest.advanceTimersByTimeAsync(1);
      expect(accept).toHaveBeenCalledWith(event);
      expect(channel.ack).toHaveBeenCalledWith(msg);
    } finally {
      await consumer.onModuleDestroy();
    }
  });
  it('dead-letters malformed, oversized and semantically invalid contracts without retries', async () => {
    const { consumer, channel, accept } = setup();
    consumer.onModuleInit();
    await jest.advanceTimersByTimeAsync(1);
    try {
      const receive = channel.consume.mock.calls[0][1];
      for (const content of [
        Buffer.from('bad JSON'),
        Buffer.alloc(8193),
        Buffer.from('{}'),
      ]) {
        const msg = { content } as ConsumeMessage;
        receive(msg);
        await jest.advanceTimersByTimeAsync(1);
        expect(channel.reject).toHaveBeenLastCalledWith(msg, false);
      }
      accept.mockRejectedValueOnce(new InvalidStockEvent('identity reused'));
      const valid = message();
      receive(valid);
      await jest.advanceTimersByTimeAsync(1);
      expect(channel.reject).toHaveBeenLastCalledWith(valid, false);
      expect(channel.ack).not.toHaveBeenCalled();
    } finally {
      await consumer.onModuleDestroy();
    }
  });
  it('delays processing retries and uses failure-counted rejection rather than ack/re-publish', async () => {
    const { consumer, channel, accept, gateway } = setup();
    consumer.onModuleInit();
    await jest.advanceTimersByTimeAsync(1);
    try {
      accept.mockRejectedValue(new Error('DB unavailable'));
      const msg = message();
      channel.consume.mock.calls[0][1](msg);
      await jest.advanceTimersByTimeAsync(1);
      expect(gateway.stockHealthy).toBe(false);
      expect(channel.reject).not.toHaveBeenCalled();
      expect(channel.ack).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(STOCK_RETRY_DELAY);
      expect(channel.reject).toHaveBeenCalledWith(msg, true);
    } finally {
      await consumer.onModuleDestroy();
    }
  });
  it('keeps committed socket work pending until publication succeeds', async () => {
    const { consumer, query, gateway } = setup();
    query.mockResolvedValue([{ event_id: event.eventId, payload: event }]);
    gateway.publishStock.mockRejectedValueOnce(new Error('socket offline'));
    await expect(consumer.dispatch()).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(1);
    await consumer.dispatch();
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("delivery_state='published'"),
      [event.eventId],
    );
  });
  it('clears retry timers on shutdown and never acknowledges abandoned processing', async () => {
    const { consumer, channel, accept } = setup();
    consumer.onModuleInit();
    await jest.advanceTimersByTimeAsync(1);
    accept.mockRejectedValue(new Error('DB down'));
    channel.consume.mock.calls[0][1](message());
    await jest.advanceTimersByTimeAsync(1);
    await consumer.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(6000);
    expect(channel.reject).not.toHaveBeenCalled();
    expect(channel.ack).not.toHaveBeenCalled();
  });
  it('reconnects after broker failures and stays offline when disabled or unconfigured', async () => {
    const { consumer, config, gateway, channel, connection } = setup();
    jest.mocked(connect).mockRejectedValueOnce(new Error('offline'));
    consumer.onModuleInit();
    await jest.advanceTimersByTimeAsync(1);
    expect(gateway.stockHealthy).toBe(false);
    await jest.advanceTimersByTimeAsync(5000);
    expect(gateway.stockHealthy).toBe(true);
    channel.emit('error', new Error('channel error'));
    connection.emit('error', new Error('connection error'));
    expect(gateway.stockHealthy).toBe(false);
    channel.emit('close');
    connection.emit('close');
    await jest.advanceTimersByTimeAsync(251);
    expect(connect).toHaveBeenCalledTimes(3);
    channel.consume.mock.calls.at(-1)![1](null);
    expect(connection.close).toHaveBeenCalled();
    await consumer.onModuleDestroy();
    config.set('MAD_REALTIME_ENABLED', 'false');
    consumer.onModuleInit();
    expect(connect).toHaveBeenCalledTimes(3);
    const missing = setup();
    missing.config.set('RABBITMQ_URL', '');
    missing.consumer.onModuleInit();
    await jest.advanceTimersByTimeAsync(1);
    expect(missing.gateway.stockHealthy).toBe(false);
    await missing.consumer.onModuleDestroy();
  });
});
