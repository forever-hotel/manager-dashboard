import { DataSource } from 'typeorm';
import { StockAlertsService } from './stock-alerts.service';
import { parseStockEvent, STOCK_STATUSES } from './stock-event';
const id = '67f4568c-89ab-4c12-b321-123456789012';
const item = '77f4568c-89ab-4c12-b321-123456789012';
const event = {
  eventId: id,
  type: 'kitchen.stock.changed' as const,
  menuItemId: item,
  stockStatus: 'LOW_STOCK' as const,
  version: 2,
  occurredAt: '2026-10-21T00:00:00Z'
};
const source = {
  name: 'Soup',
  status: 'LOW_STOCK',
  updated_at: new Date(event.occurredAt),
  version: '2'
};
const saved = {
  alertId: id,
  menuItemId: item,
  name: 'Soup',
  stockStatus: 'LOW_STOCK',
  active: true,
  version: 2,
  sourceUpdatedAt: new Date(event.occurredAt),
  raisedAt: new Date(event.occurredAt),
  clearedAt: null
};
function setup() {
  const query = jest.fn().mockResolvedValue([]);
  const transaction = jest.fn(async (work: (manager: { query: typeof query }) => Promise<void>) => work({ query }));
  return {
    query,
    transaction,
    service: new StockAlertsService({ transaction } as unknown as DataSource)
  };
}
describe('DDP-034 stock contract and durable alert processing', () => {
  it('validates all four states and strips producer fields', () => {
    for (const stockStatus of STOCK_STATUSES)
      expect(
        parseStockEvent({
          ...event,
          stockStatus,
          name: 'untrusted',
          token: 'secret'
        })
      ).toEqual({ ...event, stockStatus });
    expect(parseStockEvent({ ...event, menuItemId: item.toUpperCase() })).toEqual(event);
    for (const raw of [
      null,
      [],
      1,
      {},
      ...[
        { eventId: 'bad' },
        { menuItemId: 'bad' },
        { stockStatus: 'BAD' },
        { version: -1 },
        { version: 1.5 },
        { version: Number.MAX_SAFE_INTEGER + 1 },
        { type: 'other' },
        { occurredAt: 'bad' },
        { occurredAt: '2026-10-21T00:00:00' }
      ].map(patch => ({ ...event, ...patch }))
    ])
      expect(() => parseStockEvent(raw)).toThrow();
  });
  it('persists source-authoritative alert and its notification in one transaction', async () => {
    const { service, query } = setup();
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([source])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([saved]);
    await service.accept(event);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO mad_stock_alerts'), [
      expect.any(String),
      item,
      'Soup',
      'LOW_STOCK',
      true,
      2,
      source.updated_at
    ]);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO mad_stock_events'), [
      id,
      item,
      2,
      JSON.stringify(event),
      expect.stringContaining('stock.alert.changed'),
      'pending'
    ]);
  });
  it('coalesces a delayed event to a newer Available source and emits recovery', async () => {
    const { service, query } = setup();
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...source, status: 'AVAILABLE', version: '3' }])
      .mockResolvedValueOnce([{ version: '2' }])
      .mockResolvedValueOnce([
        {
          ...saved,
          stockStatus: 'AVAILABLE',
          version: 3,
          active: false,
          raisedAt: null,
          clearedAt: new Date(event.occurredAt)
        }
      ]);
    await service.accept(event);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO mad_stock_alerts'), [
      expect.any(String),
      item,
      'Soup',
      'AVAILABLE',
      false,
      3,
      source.updated_at
    ]);
  });
  it('skips matching duplicates without reading the source and rejects identity reuse', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ same: true }]);
    await service.accept(event);
    expect(query).toHaveBeenCalledTimes(2);
    query
      .mockClear()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ same: false }]);
    await expect(service.accept(event)).rejects.toThrow('identity reused');
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('stores stale receipts without updating counts or dispatching stale alerts', async () => {
    const { service, query } = setup();
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([source])
      .mockResolvedValueOnce([{ version: '2' }]);
    await service.accept(event);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO mad_stock_events'), [
      id,
      item,
      2,
      JSON.stringify(event),
      null,
      'superseded'
    ]);
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO mad_stock_alerts'), expect.anything());
  });
  it('fails safely on missing, malformed, behind or contradictory source rows', async () => {
    for (const bad of [
      undefined,
      { ...source, name: null },
      { ...source, name: '' },
      { ...source, name: 'x'.repeat(256) },
      { ...source, status: 'BAD' },
      { ...source, updated_at: 'bad' },
      { ...source, updated_at: new Date('bad') },
      { ...source, version: '1' },
      { ...source, version: '9007199254740992' },
      { ...source, status: 'AVAILABLE' }
    ]) {
      const { service, query } = setup();
      query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(bad ? [bad] : []);
      await expect(service.accept(event)).rejects.toThrow();
      expect(query).toHaveBeenCalledTimes(3);
    }
  });
  it('refuses acknowledgement when storage fails or returns no persisted alert', async () => {
    const failed = setup();
    failed.query.mockRejectedValue(new Error('DB offline'));
    await expect(failed.service.accept(event)).rejects.toThrow('DB offline');
    const { service, query } = setup();
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([source])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await expect(service.accept(event)).rejects.toThrow('Missing persisted');
  });
});
