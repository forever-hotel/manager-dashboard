import { DataSource } from 'typeorm';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { parseRoomEvent, RoomEventsConsumer } from '../realtime/room-events.consumer';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ConfigService } from '@nestjs/config';

const room = {
  id: '101',
  number: '101',
  floor: 1,
  typeId: 'type-id',
  type: 'Deluxe',
  status: 'VACANT',
  updatedAt: '2026-10-20T00:00:00Z',
  version: 2
};
const event = {
  eventId: '67f4568c-89ab-4c12-b321-123456789012',
  type: 'room.status.changed' as const,
  roomId: '101',
  version: 2,
  occurredAt: '2026-10-20T00:00:00Z'
};
describe('DDP-027 room snapshot and event contract', () => {
  it('keeps room dispatch pending on socket failure and marks it only after send', async () => {
    const query = jest.fn().mockResolvedValue([{ event_id: event.eventId, payload: { ...event, room } }]);
    const publishRoom = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const service = new RoomEventsConsumer(
      new ConfigService(),
      { query } as unknown as DataSource,
      { publishRoom } as unknown as RealtimeGateway,
      {} as RoomsService
    );

    await expect(service.dispatch()).rejects.toThrow('offline');
    expect(query).toHaveBeenCalledTimes(1);
    query.mockClear();
    await service.dispatch();
    expect(publishRoom).toHaveBeenLastCalledWith({ ...event, room });
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE mad_room_events'), [event.eventId]);
  });
  it('maps all source states and exposes the existing primary key without source writes', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        queried_at: new Date(),
        rooms: ['OCCUPIED', 'VACANT', 'UNDER_MAINTENANCE', 'REQUIRES_CLEANING'].map(status => ({ ...room, status }))
      }
    ]);
    const service = new RoomsService({ query } as unknown as DataSource);

    expect((await new RoomsController(service).status({})).rooms.map(r => r.label)).toEqual([
      'Occupied',
      'Vacant',
      'Under Maintenance',
      'Requires Cleaning'
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT'), [null]);
    expect(() => new RoomsController(service).status({ status: 'VACANT' })).toThrow();
  });
  it('distinguishes empty sources from malformed or unavailable ones', async () => {
    const query = jest.fn();
    const service = new RoomsService({ query } as unknown as DataSource);

    query.mockResolvedValueOnce([{ queried_at: new Date(), rooms: [] }]);
    expect((await service.snapshot()).rooms).toEqual([]);
    for (const rows of [
      [],
      [{ rooms: null }],
      ...[
        { id: '' },
        { id: null },
        { id: '12345678901' },
        { number: 'other' },
        { floor: null },
        { floor: 1.5 },
        { typeId: null },
        { type: null },
        { type: '' },
        { status: 'BROKEN' },
        { version: -1 },
        { version: 9007199254740992 },
        { updatedAt: 'bad' }
      ].map(patch => [{ queried_at: new Date(), rooms: [{ ...room, ...patch }] }])
    ]) {
      query.mockResolvedValueOnce(rows);
      await expect(service.snapshot()).rejects.toMatchObject({ status: 503 });
    }
    query.mockRejectedValue(new Error('private SQL'));
    await expect(service.snapshot()).rejects.toMatchObject({ status: 503 });
  });
  it('validates room identifiers, version and timestamp without accepting producer room payload', () => {
    expect(parseRoomEvent({ ...event, room: { status: 'fake' } })).toEqual(event);
    for (const patch of [
      { type: 'other' },
      { eventId: 'bad' },
      { roomId: '' },
      { roomId: '12345678901' },
      { roomId: 'x\n' },
      { version: -1 },
      { occurredAt: 'bad' }
    ])
      expect(() => parseRoomEvent({ ...event, ...patch })).toThrow();
  });
  it('hydrates from authoritative source, rejects a behind/missing source, suppresses stale versions', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const transaction = jest.fn(async (work: (m: { query: typeof query }) => Promise<void>) => work({ query }));
    const snapshot = jest.fn().mockResolvedValue({ rooms: [room] });
    const service = new RoomEventsConsumer(
      new ConfigService(),
      { transaction } as unknown as DataSource,
      {} as RealtimeGateway,
      { snapshot } as unknown as RoomsService
    );

    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([]);
    await service.accept(event);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO mad_room_versions'), ['101', 2]);
    query
      .mockClear()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: true }]);
    await service.accept(event);
    expect(query).toHaveBeenCalledTimes(2);
    query
      .mockClear()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([{ version: '3' }]);
    await service.accept(event);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO mad_room_events'),
      expect.arrayContaining([true])
    );
    snapshot.mockResolvedValueOnce({ rooms: [] });
    await expect(service.accept(event)).rejects.toThrow();
    snapshot.mockResolvedValueOnce({ rooms: [{ ...room, version: 1 }] });
    await expect(service.accept(event)).rejects.toThrow();
  });
});
