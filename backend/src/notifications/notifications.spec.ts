import { DataSource } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NotificationsService } from './notifications.service';
import { NotificationsWorker } from './notifications.worker';
import { NotificationIdentityDto, NotificationPageDto, ReadNotificationDto } from './notifications.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsController } from './notifications.controller';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
const id = '67f4568c-89ab-4c12-b321-123456789012';
const item = {
  type: 'COMPLAINT' as const,
  sourceId: id,
  title: 'Complaint: Room',
  status: 'SUBMITTED',
  occurredAt: '2026-10-21T00:00:00Z',
  revision: 'SUBMITTED:0',
  isRead: false
};
const row = {
  queried_at: new Date(item.occurredAt),
  total: 1,
  unread: 1,
  complaints: 1,
  stock: 0,
  invalid: false,
  items: [item]
};
function setup() {
  const query = jest.fn().mockResolvedValue([row]);
  const transaction = jest.fn(async (work: (m: { query: typeof query }) => Promise<void>) => work({ query }));
  return {
    query,
    service: new NotificationsService({
      query,
      transaction
    } as unknown as DataSource)
  };
}
describe('DDP-043 authoritative notifications', () => {
  it.each(['LOW_STOCK', 'UNAVAILABLE', 'TEMPORARILY_DISABLED'])('includes the active stock state %s', async status => {
    const { query, service } = setup();
    query.mockResolvedValueOnce([
      {
        ...row,
        complaints: 0,
        stock: 1,
        items: [{ ...item, type: 'STOCK', status, revision: '123' }]
      }
    ]);
    expect((await service.snapshot(id, new NotificationPageDto())).items[0]).toMatchObject({ type: 'STOCK', status });
  });
  it('projects safe deduplicated issue links, consistent counts and empty/beyond-last pages', async () => {
    const { query, service } = setup();
    const controller = new NotificationsController(service);
    const req = { user: { sub: id } } as AuthenticatedRequest;
    expect(await controller.list(req, new NotificationPageDto())).toMatchObject({
      total: 1,
      unread: 1,
      items: [{ id: 'COMPLAINT:' + id, href: '/complaints?complaintId=' + id }]
    });
    expect(query).toHaveBeenCalledWith(expect.any(String), [id, 20, 0]);
    query.mockResolvedValueOnce([
      {
        ...row,
        complaints: 0,
        stock: 1,
        items: [
          {
            ...item,
            type: 'STOCK',
            status: 'LOW_STOCK',
            revision: '123',
            note: 'private'
          }
        ]
      }
    ]);
    expect((await service.snapshot(id, new NotificationPageDto())).items[0]).toEqual({
      ...item,
      type: 'STOCK',
      status: 'LOW_STOCK',
      revision: '123',
      id: 'STOCK:' + id,
      href: '/notifications?page=1#stock-' + id
    });
    for (const source of [
      { ...row, total: 0, unread: 0, complaints: 0, items: [] },
      { ...row, items: [] }
    ]) {
      query.mockResolvedValueOnce([source]);
      expect((await service.snapshot(id, { page: 2, pageSize: 20 })).items).toEqual([]);
    }
  });
  it('rejects malformed or inconsistent source results rather than inventing zero alerts', async () => {
    const { query, service } = setup();
    const invalid: unknown[] = [
      undefined,
      { ...row, invalid: true },
      { ...row, total: -1 },
      { ...row, unread: 2 },
      { ...row, stock: 1 },
      { ...row, queried_at: 'bad' },
      { ...row, queried_at: new Date('bad') },
      { ...row, items: null },
      { ...row, items: [] },
      { ...row, total: 2, complaints: 2, items: [item, item] }
    ];
    for (const patch of [
      { type: 'BAD' },
      { sourceId: 3 },
      { sourceId: 'bad' },
      { title: 3 },
      { title: ' ' },
      { title: 'x'.repeat(266) },
      { title: '\u0000' },
      { revision: 3 },
      { revision: 'bad space' },
      { isRead: 'yes' },
      { occurredAt: 3 },
      { occurredAt: '2026-02-30T00:00:00Z' },
      { occurredAt: '2026-10-21T00:00:00' },
      { status: 'RESOLVED' },
      { type: 'STOCK', status: 'AVAILABLE' }
    ])
      invalid.push({ ...row, items: [{ ...item, ...patch }] });
    invalid.push({ ...row, items: [null] });
    for (const source of invalid) {
      query.mockResolvedValueOnce(source === undefined ? [] : [source]);
      await expect(service.snapshot(id, new NotificationPageDto())).rejects.toMatchObject({ status: 503 });
    }
    query.mockRejectedValueOnce(new Error('private SQL'));
    await expect(service.snapshot(id, new NotificationPageDto())).rejects.toMatchObject({
      status: 503,
      message: 'Service Unavailable'
    });
  });
  it('marks only the requesting manager read, with conflict and recovery checks and no source writes', async () => {
    const { query, service } = setup();
    query.mockResolvedValueOnce([{ entity_id: id }]);
    const controller = new NotificationsController(service);
    expect(
      await controller.read(
        { user: { sub: id } } as AuthenticatedRequest,
        { type: 'COMPLAINT', id },
        { revision: item.revision },
        {}
      )
    ).toEqual({ read: true });
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO public.mad_notification_reads'), [
      id,
      'COMPLAINT',
      id,
      item.revision
    ]);
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(service.markRead(id, { type: 'STOCK', id }, '123')).rejects.toMatchObject({ status: 404 });
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id }]);
    await expect(service.markRead(id, { type: 'STOCK', id }, '123')).rejects.toMatchObject({ status: 409 });
    query.mockRejectedValueOnce(new Error('private'));
    await expect(service.markRead(id, { type: 'STOCK', id }, '123')).rejects.toMatchObject({ status: 503 });
  });
  it('validates bounded pagination, identity and read revision DTOs', async () => {
    expect(await validate(new NotificationPageDto())).toEqual([]);
    for (const raw of [
      { page: '0' },
      { page: '1e2' },
      { page: '0x10' },
      { page: ['1', '2'] },
      { pageSize: '101' },
      { pageSize: '1.0' },
      { extra: 1 }
    ])
      expect(
        (
          await validate(plainToInstance(NotificationPageDto, raw), {
            whitelist: true,
            forbidNonWhitelisted: true
          })
        ).length
      ).toBeGreaterThan(0);
    expect(await validate(plainToInstance(NotificationIdentityDto, { type: 'STOCK', id }))).toEqual([]);
    expect(
      (await validate(plainToInstance(NotificationIdentityDto, { type: 'BAD', id: 'bad' }))).length
    ).toBeGreaterThan(0);
    expect((await validate(plainToInstance(ReadNotificationDto, { revision: 'bad space' }))).length).toBeGreaterThan(0);
  });
  it('polls source changes, retains invalidations after send failure and recovers after storage errors', async () => {
    const { query, service } = setup();
    query.mockResolvedValueOnce([{ revision: 'a'.repeat(32) }]);
    expect(await service.fingerprint()).toBe('a'.repeat(32));
    for (const rows of [[], [{ revision: 'bad' }]]) {
      query.mockResolvedValueOnce(rows);
      await expect(service.fingerprint()).rejects.toThrow();
    }
    const fingerprint = jest.fn().mockResolvedValue('a');
    const send = jest.fn().mockResolvedValue(undefined);
    const gateway = { send, notificationsHealthy: false };
    const worker = new NotificationsWorker(
      { fingerprint } as unknown as NotificationsService,
      gateway as unknown as RealtimeGateway
    );
    await worker.tick();
    await worker.tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(gateway.notificationsHealthy).toBe(true);
    fingerprint.mockResolvedValue('b');
    send.mockRejectedValueOnce(new Error('offline'));
    await worker.tick();
    expect(gateway.notificationsHealthy).toBe(false);
    await worker.tick();
    expect(send).toHaveBeenCalledTimes(3);
    fingerprint.mockRejectedValueOnce(new Error('source'));
    await worker.tick();
    expect(gateway.notificationsHealthy).toBe(false);
    jest.useFakeTimers();
    try {
      worker.onApplicationBootstrap();
      await Promise.resolve();
      await Promise.resolve();
      await worker.onApplicationShutdown();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
