import { EventEmitter } from 'node:events';
import { connect } from 'amqplib';
import type { ChannelModel, Channel, ConsumeMessage } from 'amqplib';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { RealtimeConsumer } from './realtime.consumer';
import { RealtimeGateway } from './realtime.gateway';
jest.mock('amqplib', () => ({ connect: jest.fn() }));
const event = {
  eventId: '67f4568c-89ab-4c12-b321-123456789012',
  orderId: '77f4568c-89ab-4c12-b321-123456789012',
  type: 'kitchen.order.changed',
  version: 2,
  occurredAt: '2026-10-19T00:00:00Z',
};
describe('DDP-039 durable broker lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(connect).mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
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
      nack: jest.fn(),
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
      healthy: false,
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const consumer = new RealtimeConsumer(
      config,
      { query } as unknown as DataSource,
      gateway as unknown as RealtimeGateway,
    );
    return { channel, connection, config, query, gateway, consumer };
  }
  it('declares durable routing with explicit acknowledgements and dead-letters invalid messages', async () => {
    const { consumer, channel, gateway } = setup();
    consumer.onModuleInit();
    await jest.advanceTimersByTimeAsync(1);
    try {
      expect(gateway.healthy).toBe(true);
      expect(channel.assertExchange).toHaveBeenCalledWith(
        'hotel.events',
        'topic',
        { durable: true },
      );
      expect(channel.prefetch).toHaveBeenCalledWith(1);
      expect(channel.consume).toHaveBeenCalledWith(
        'mad.kitchen',
        expect.any(Function),
        { noAck: false },
      );
      const receive = channel.consume.mock.calls[0][1];
      for (const content of [
        Buffer.from('bad JSON'),
        Buffer.alloc(8193),
        Buffer.from('{}'),
      ]) {
        const message = { content } as ConsumeMessage;
        receive(message);
        expect(channel.nack).toHaveBeenLastCalledWith(message, false, false);
      }
      const accepted = jest
        .spyOn(consumer, 'accept')
        .mockResolvedValue(undefined);
      const message = {
        content: Buffer.from(JSON.stringify(event)),
      } as ConsumeMessage;
      receive(message);
      await jest.advanceTimersByTimeAsync(1);
      expect(accepted).toHaveBeenCalledWith(event);
      expect(channel.ack).toHaveBeenCalledWith(message);
    } finally {
      await consumer.onModuleDestroy();
    }
  });
  it('closes the connection without ack on persistence failure so RabbitMQ can requeue', async () => {
    const { consumer, channel, connection, gateway } = setup();
    consumer.onModuleInit();
    await jest.advanceTimersByTimeAsync(1);
    try {
      jest
        .spyOn(consumer, 'accept')
        .mockRejectedValue(new Error('DB unavailable'));
      const receive = channel.consume.mock.calls[0][1];
      receive({
        content: Buffer.from(JSON.stringify(event)),
      } as ConsumeMessage);
      await jest.advanceTimersByTimeAsync(1);
      expect(channel.ack).not.toHaveBeenCalled();
      expect(connection.close).toHaveBeenCalled();
      expect(gateway.healthy).toBe(false);
    } finally {
      await consumer.onModuleDestroy();
    }
  });
  it('handles broker errors, consumer cancellation and reconnects after connection close', async () => {
    const { consumer, channel, connection, gateway } = setup();
    consumer.onModuleInit();
    await jest.advanceTimersByTimeAsync(1);
    try {
      channel.emit('error', new Error('channel error'));
      expect(gateway.healthy).toBe(false);
      connection.emit('error', new Error('connection error'));
      expect(gateway.healthy).toBe(false);
      const receive = channel.consume.mock.calls[0][1];
      receive(null);
      expect(connection.close).toHaveBeenCalled();
      channel.emit('close');
      connection.emit('close');
      await jest.advanceTimersByTimeAsync(251);
      expect(connect).toHaveBeenCalledTimes(2);
    } finally {
      await consumer.onModuleDestroy();
    }
  });
  it('retries connection failures with bounded delay, and stays offline if disabled or unconfigured', async () => {
    const { consumer, config, gateway } = setup();
    jest.mocked(connect).mockRejectedValueOnce(new Error('offline'));
    consumer.onModuleInit();
    await jest.advanceTimersByTimeAsync(1);
    expect(gateway.healthy).toBe(false);
    await jest.advanceTimersByTimeAsync(5000);
    expect(gateway.healthy).toBe(true);
    await consumer.onModuleDestroy();
    config.set('MAD_REALTIME_ENABLED', 'false');
    consumer.onModuleInit();
    expect(connect).toHaveBeenCalledTimes(2);
    const other = setup();
    other.config.set('RABBITMQ_URL', '');
    other.consumer.onModuleInit();
    await jest.advanceTimersByTimeAsync(1);
    expect(other.gateway.healthy).toBe(false);
    await other.consumer.onModuleDestroy();
  });
});
