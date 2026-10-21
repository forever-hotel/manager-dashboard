import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { RealtimeGateway, KitchenEvent } from './realtime.gateway';
import {
  InvalidKitchenEvent,
  parseKitchenEvent,
  RealtimeConsumer,
} from './realtime.consumer';
import { RealtimeController } from './realtime.controller';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
const event: KitchenEvent = {
  eventId: '67f4568c-89ab-4c12-b321-123456789012',
  orderId: '77f4568c-89ab-4c12-b321-123456789012',
  type: 'kitchen.order.changed',
  version: 2,
  occurredAt: '2026-10-19T00:00:00Z',
};
describe('DDP-039 event validation and persistence', () => {
  it('accepts only versioned timestamped kitchen events and discards unknown fields', () => {
    expect(parseKitchenEvent({ ...event, secret: 'hidden' })).toEqual(event);
    expect(
      parseKitchenEvent({
        ...event,
        eventId: event.eventId.toUpperCase(),
        orderId: event.orderId.toUpperCase(),
      }),
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
      { ...event, occurredAt: '2026-10-19T00:00:00' },
    ])
      expect(() => parseKitchenEvent(value)).toThrow();
  });
  it('commits before delivery; suppresses duplicates and stale versions durably', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const transaction = jest.fn(
      async (work: (manager: { query: typeof query }) => Promise<void>) =>
        work({ query }),
    );
    const service = new RealtimeConsumer(
      new ConfigService(),
      { transaction } as unknown as DataSource,
      {} as RealtimeGateway,
    );
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([]);
    await service.accept(event);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO mad_realtime_versions'),
      [event.orderId, 2],
    );
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
      expect.arrayContaining([true]),
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
        transaction: (
          work: (manager: { query: typeof query }) => Promise<void>,
        ) => work({ query }),
      } as unknown as DataSource,
      {} as RealtimeGateway,
    );
    await expect(
      service.accept({ ...event, version: 3 }),
    ).rejects.toBeInstanceOf(InvalidKitchenEvent);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('leaves dispatch pending on send failure and marks it only after send succeeds', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([{ event_id: event.eventId, payload: event }]);
    const publish = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const service = new RealtimeConsumer(
      new ConfigService(),
      { query } as unknown as DataSource,
      { publish } as unknown as RealtimeGateway,
    );
    await expect(service.dispatch()).rejects.toThrow('offline');
    expect(query).toHaveBeenCalledTimes(1);
    query.mockClear();
    await service.dispatch();
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE mad_realtime_events'),
      [event.eventId],
    );
    service.onModuleInit();
    await service.onModuleDestroy();
  });
});
describe('DDP-039 one-use ticket and session enforcement', () => {
  function setup() {
    const session = jest.fn().mockResolvedValue({});
    const gateway = new RealtimeGateway(
      { session } as unknown as AuthService,
      new ConfigService({ FRONTEND_URL: 'http://localhost:3000' }),
    );
    let middleware: (
      socket: Socket,
      next: (error?: Error) => void,
    ) => void = () => undefined;
    let connection: (socket: Socket) => void = () => undefined;
    gateway.afterInit({
      use: (fn: typeof middleware) => {
        middleware = fn;
      },
      on: (_name: string, fn: typeof connection) => {
        connection = fn;
      },
    } as unknown as Server);
    const emit = jest.fn(),
      disconnect = jest.fn();
    const sock = {
      handshake: {
        auth: { ticket: '' },
        headers: { origin: 'http://localhost:3000' },
      },
      connected: true,
      emit,
      on: jest.fn(),
      disconnect,
    } as unknown as Socket;
    const authorize = () =>
      new Promise<Error | undefined>((resolve) => middleware(sock, resolve));
    return { gateway, session, sock, authorize, connection, emit, disconnect };
  }
  it('checks origin, ticket expiry/reuse and account session before subscribing or sending', async () => {
    const { gateway, session, sock, authorize, connection, emit, disconnect } =
      setup();
    try {
      expect(await authorize()).toBeInstanceOf(Error);
      sock.handshake.auth.ticket = gateway.ticket('private').ticket;
      expect(await authorize()).toBeUndefined();
      connection(sock);
      expect(emit).toHaveBeenCalledWith('transport.status', {
        healthy: false,
      });
      expect(await authorize()).toBeInstanceOf(Error);
      await gateway.publish(event);
      expect(emit).toHaveBeenCalledWith('kitchen.order.changed', event);
      const roomEvent = {
        eventId: event.eventId,
        type: 'room.status.changed' as const,
        roomId: '101',
        version: 2,
        occurredAt: event.occurredAt,
      };
      await gateway.publishRoom(roomEvent);
      expect(emit).toHaveBeenCalledWith('room.status.changed', roomEvent);
      const taskEvent = {
        ...event,
        type: 'task.changed' as const,
        taskId: event.orderId,
      };
      await gateway.publishTask(taskEvent);
      expect(emit).toHaveBeenCalledWith('task.changed', taskEvent);
      const stockEvent = {
        eventId: event.eventId,
        type: 'stock.alert.changed' as const,
        menuItemId: event.orderId,
        version: 2,
        occurredAt: event.occurredAt,
        alert: {
          alertId: event.eventId,
          menuItemId: event.orderId,
          name: 'Soup',
          stockStatus: 'LOW_STOCK' as const,
          active: true,
          version: 2,
          sourceUpdatedAt: event.occurredAt,
          raisedAt: event.occurredAt,
          clearedAt: null,
        },
      };
      await gateway.publishStock(stockEvent);
      expect(emit).toHaveBeenCalledWith('stock.alert.changed', stockEvent);
      session.mockRejectedValueOnce(new Error('revoked'));
      const beforeRevocation = emit.mock.calls.length;
      await gateway.publishStock(stockEvent);
      expect(emit.mock.calls).toHaveLength(beforeRevocation);
      await gateway.publish(event);
      expect(disconnect).toHaveBeenCalledWith(true);
      sock.handshake.auth.ticket = gateway.ticket('private').ticket;
      sock.handshake.headers.origin = 'http://untrusted';
      expect(await authorize()).toBeInstanceOf(Error);
      sock.handshake.headers.origin = 'http://localhost:3000';
      session.mockRejectedValueOnce(new Error('forbidden'));
      sock.handshake.auth.ticket = gateway.ticket('private').ticket;
      expect(await authorize()).toBeInstanceOf(Error);
    } finally {
      gateway.onModuleDestroy();
    }
  });
  it('expires tickets, bounds outstanding tickets and refuses publish before socket initialization', async () => {
    const { gateway, sock, authorize } = setup();
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      sock.handshake.auth.ticket = gateway.ticket('private').ticket;
      clock.mockReturnValue(now + 30000);
      expect(await authorize()).toBeInstanceOf(Error);
      for (let i = 0; i < 1000; i++) gateway.ticket('private');
      expect(() => gateway.ticket('private')).toThrow();
      clock.mockReturnValue(now + 62000);
      expect(gateway.ticket('private').expiresIn).toBe(30);
    } finally {
      clock.mockRestore();
      gateway.onModuleDestroy();
    }
    await expect(
      new RealtimeGateway({} as AuthService, new ConfigService()).publish(
        event,
      ),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('issues the socket ticket from the protected bearer context only', () => {
    const ticket = jest.fn().mockReturnValue({ ticket: 'one-use' });
    const controller = new RealtimeController({
      ticket,
    } as unknown as RealtimeGateway);
    expect(
      controller.ticket({
        headers: { authorization: 'Bearer private' },
      } as AuthenticatedRequest),
    ).toEqual({ ticket: 'one-use' });
    expect(ticket).toHaveBeenCalledWith('private');
  });
  it.each([
    [null],
    [[]],
    ['invalid'],
    [{ ticket: 1 }],
    [{ ticket: 'oversized'.repeat(100) }],
  ])(
    'rejects malformed handshake auth without exposing an exception: %j',
    async (auth: unknown) => {
      const { gateway, sock, authorize } = setup();
      try {
        sock.handshake.auth = auth as Socket['handshake']['auth'];
        expect(await authorize()).toEqual(new Error('UNAUTHENTICATED'));
      } finally {
        gateway.onModuleDestroy();
      }
    },
  );
});
