import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { connect } from 'amqplib';
import type { ChannelModel } from 'amqplib';
import { PromotionBroker, PromotionMessage } from './promotion-broker';
import { PromotionPublicationWorker } from './promotion-publication.worker';
jest.mock('amqplib', () => ({ connect: jest.fn() }));
const row = {
  event_id: '67f4568c-89ab-4c12-b321-123456789012',
  promo_id: '77f4568c-89ab-4c12-b321-123456789012',
  promotion_version: 2,
  event_type: 'promotion.upsert' as const,
  payload: {
    id: '77f4568c-89ab-4c12-b321-123456789012',
    version: 2,
    deletedAt: null
  },
  created_at: new Date('2026-10-21T00:00:00Z'),
  attempts: 0
};
const event: PromotionMessage = {
  eventId: row.event_id,
  type: row.event_type,
  promotionId: row.promo_id,
  version: 2,
  occurredAt: row.created_at.toISOString(),
  promotion: row.payload
};
describe('DDP-040 durable publication worker', () => {
  function setup(enabled = 'true') {
    const query = jest.fn().mockResolvedValueOnce([row]).mockResolvedValue([]);
    const publish = jest.fn().mockResolvedValue(undefined);
    const config = new ConfigService({
      MAD_PROMOTIONS_PUBLISH_ENABLED: enabled
    });
    const worker = new PromotionPublicationWorker(
      config,
      {
        transaction: (work: (manager: { query: typeof query }) => Promise<void>) => work({ query })
      } as unknown as DataSource,
      { publish } as unknown as PromotionBroker
    );
    return { query, publish, config, worker };
  }
  it('locks pending work and marks published only after confirmation', async () => {
    const { query, publish, worker } = setup();
    let confirm!: () => void;
    publish.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          confirm = resolve;
        })
    );
    const pending = worker.processOnce();
    await Promise.resolve();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('FOR UPDATE OF o SKIP LOCKED'));
    confirm();
    await pending;
    expect(publish).toHaveBeenCalledWith(event);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('published_at=now()'), [row.event_id]);
  });
  it('retains failed work with capped exponential retry and a fixed safe error', async () => {
    const { query, publish, worker } = setup();
    publish.mockRejectedValue(new Error('private broker credentials'));
    await worker.processOnce();
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("last_error='PROMOTION_PUBLICATION_FAILED'"), [
      row.event_id,
      1
    ]);
    expect(JSON.stringify(query.mock.calls)).not.toContain('private');
    const later = setup();
    later.query
      .mockReset()
      .mockResolvedValueOnce([{ ...row, attempts: 100 }])
      .mockResolvedValue([]);
    later.publish.mockRejectedValue(new Error('offline'));
    await later.worker.processOnce();
    expect(later.query).toHaveBeenLastCalledWith(expect.any(String), [row.event_id, 3600]);
  });
  it('does not swallow a failed confirmation mark, enabling rollback/redelivery', async () => {
    const { worker, query, publish } = setup();
    query.mockReset().mockResolvedValueOnce([row]).mockRejectedValueOnce(new Error('mark failed'));
    await expect(worker.processOnce()).rejects.toThrow('mark failed');
    expect(publish).toHaveBeenCalledWith(event);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('leaves malformed private outbox data pending and does not publish it', async () => {
    const { worker, query, publish } = setup();
    query
      .mockReset()
      .mockResolvedValueOnce([{ ...row, payload: { ...row.payload, version: 3 } }])
      .mockResolvedValue([]);
    await worker.processOnce();
    expect(publish).not.toHaveBeenCalled();
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('next_attempt_at'), [row.event_id, 1]);
  });
  it('does nothing when disabled or idle', async () => {
    const disabled = setup('false');
    disabled.worker.onApplicationBootstrap();
    await disabled.worker.processOnce();
    expect(disabled.query).not.toHaveBeenCalled();
    const idle = setup();
    idle.query.mockReset().mockResolvedValue([]);
    await idle.worker.processOnce();
    expect(idle.publish).not.toHaveBeenCalled();
  });
  it('serializes scheduler ticks and waits for in-flight work on shutdown', async () => {
    jest.useFakeTimers();
    const { worker } = setup();
    let finish!: () => void;
    const processCall = jest.spyOn(worker, 'processOnce').mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    );
    try {
      worker.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(1000);
      expect(processCall).toHaveBeenCalledTimes(1);
      const shutdown = worker.onApplicationShutdown();
      finish();
      await shutdown;
      await jest.advanceTimersByTimeAsync(1000);
      expect(processCall).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('DDP-040 broker confirms and mandatory routing', () => {
  function setup() {
    const channel = Object.assign(new EventEmitter(), {
      assertExchange: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn(
        (_exchange: string, _key: string, _body: Buffer, _options: object, confirm: (error?: Error) => void) => {
          confirm();
          return true;
        }
      )
    });
    const connection = Object.assign(new EventEmitter(), {
      createConfirmChannel: jest.fn().mockResolvedValue(channel),
      close: jest.fn().mockResolvedValue(undefined)
    });
    jest.mocked(connect).mockResolvedValue(connection as unknown as ChannelModel);
    const broker = new PromotionBroker(new ConfigService({ RABBITMQ_URL: 'amqp://localhost/mad_test' }));
    return { channel, connection, broker };
  }
  it('publishes immutable persistent envelopes with confirms and closes resources', async () => {
    const { broker, channel, connection } = setup();
    await broker.publish(event);
    expect(channel.assertExchange).toHaveBeenCalledWith('hotel.events', 'topic', { durable: true });
    expect(channel.publish).toHaveBeenCalledWith(
      'hotel.events',
      'promotion.upsert',
      Buffer.from(JSON.stringify(event)),
      expect.objectContaining({
        persistent: true,
        mandatory: true,
        messageId: event.eventId
      }),
      expect.any(Function)
    );
    expect(connection.close).toHaveBeenCalled();
  });
  it.each(['returned', 'nacked'])('rejects %s messages rather than marking them published', async mode => {
    const { broker, channel, connection } = setup();
    channel.publish.mockImplementationOnce((_e, _k, _b, _o, confirm) => {
      if (mode === 'returned') channel.emit('return', {});
      confirm(mode === 'nacked' ? new Error('nack') : undefined);
      return true;
    });
    await expect(broker.publish(event)).rejects.toThrow('PROMOTION_NOT_ROUTED');
    expect(connection.close).toHaveBeenCalled();
  });
  it('bounds missing confirms and rejects oversized envelopes', async () => {
    jest.useFakeTimers();
    const { broker, channel, connection } = setup();
    channel.publish.mockImplementationOnce(() => true);
    try {
      const pending = expect(broker.publish(event)).rejects.toThrow('PROMOTION_CONFIRM_TIMEOUT');
      await jest.advanceTimersByTimeAsync(5001);
      await pending;
      expect(connection.close).toHaveBeenCalled();
      await expect(broker.publish({ ...event, promotion: { value: 'x'.repeat(65536) } })).rejects.toThrow(
        'PROMOTION_EVENT_TOO_LARGE'
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
