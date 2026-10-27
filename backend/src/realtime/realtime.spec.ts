import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { RealtimeGateway, KitchenEvent } from './realtime.gateway';
import { InvalidKitchenEvent, parseKitchenEvent, RealtimeConsumer } from './realtime.consumer';
const event: KitchenEvent = {
  eventId: '67f4568c-89ab-4c12-b321-123456789012',
  orderId: '77f4568c-89ab-4c12-b321-123456789012',
  type: 'kitchen.order.changed',
  version: 2,
  occurredAt: '2026-10-19T00:00:00Z'
};
describe('DDP-039 event validation and persistence', () => {
  it('accepts only versioned timestamped kitchen events and discards unknown fields', () => {
    expect(parseKitchenEvent({ ...event, secret: 'hidden' })).toEqual(event);
    expect(
      parseKitchenEvent({
        ...event,
        eventId: event.eventId.toUpperCase(),
        orderId: event.orderId.toUpperCase()
      })
    ).toEqual(event);
    for (const value of [
      null,
      1,
      {},
      { ...event, type: 'other' },
      { ...event, eventId: 'bad' },
      { ...event, orderId: 1 },
      { ...event, version: -1 },
      { ...event, version: Infinity },
      { ...event, occurredAt: 'yesterday' },
      { ...event, occurredAt: '2026-10-19T00:00:00' }
    ])
      expect(() => parseKitchenEvent(value)).toThrow();
  });
  it('commits before delivery; suppresses duplicates and stale versions durably', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const transaction = jest.fn(async (work: (manager: { query: typeof query }) => Promise<void>) => work({ query }));
    const service = new RealtimeConsumer(
      new ConfigService(),
      { transaction } as unknown as DataSource,
      {} as RealtimeGateway
    );
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([]);
    await service.accept(event);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO mad_realtime_versions'), [
      event.orderId,
      2
    ]);
    query
      .mockClear()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: true, payload: event }]);
    await service.accept(event);
    expect(query).toHaveBeenCalledTimes(2);
    query
      .mockClear()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([{ version: '3' }]);
    await service.accept(event);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO mad_realtime_events'),
      expect.arrayContaining([true])
    );
  });
  it('rejects reuse of a persisted event ID with different content without writing', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: true, payload: event }]);
    const service = new RealtimeConsumer(
      new ConfigService(),
      {
        transaction: (work: (manager: { query: typeof query }) => Promise<void>) => work({ query })
      } as unknown as DataSource,
      {} as RealtimeGateway
    );
    await expect(service.accept({ ...event, version: 3 })).rejects.toBeInstanceOf(InvalidKitchenEvent);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('leaves dispatch pending on send failure and marks it only after send succeeds', async () => {
    const query = jest.fn().mockResolvedValue([{ event_id: event.eventId, payload: event }]);
    const publish = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const service = new RealtimeConsumer(
      new ConfigService(),
      { query } as unknown as DataSource,
      { publish } as unknown as RealtimeGateway
    );
    await expect(service.dispatch()).rejects.toThrow('offline');
    expect(query).toHaveBeenCalledTimes(1);
    query.mockClear();
    await service.dispatch();
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE mad_realtime_events'), [event.eventId]);
    service.onModuleInit();
    await service.onModuleDestroy();
  });
});
