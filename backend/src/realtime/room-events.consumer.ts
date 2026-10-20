import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isISO8601, isUUID } from 'class-validator';
import { connect, ChannelModel, Channel } from 'amqplib';
import { DataSource } from 'typeorm';
import { RealtimeGateway } from './realtime.gateway';
import { RoomsService } from '../rooms/rooms.service';
import type { RoomStatus } from '../rooms/rooms.service';
export interface RoomEvent {
  eventId: string;
  type: 'room.status.changed';
  roomId: string;
  version: number;
  occurredAt: string;
  room?: RoomStatus;
}

export function parseRoomEvent(raw: unknown): RoomEvent {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid event');
  const e = raw as Record<string, unknown>;
  if (
    e.type !== 'room.status.changed' ||
    typeof e.eventId !== 'string' ||
    !isUUID(e.eventId) ||
    typeof e.roomId !== 'string' ||
    !e.roomId.length ||
    e.roomId.length > 10 ||
    Array.from(e.roomId).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
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
    roomId: e.roomId,
    version: Number(e.version),
    occurredAt: e.occurredAt,
  };
}
@Injectable()
export class RoomEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private connection?: ChannelModel;
  private channel?: Channel;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private busy = false;
  constructor(
    private readonly config: ConfigService,
    private readonly database: DataSource,
    private readonly gateway: RealtimeGateway,
    private readonly rooms: RoomsService,
  ) {}
  onModuleInit() {
    if (this.config.get<string>('MAD_REALTIME_ENABLED') === 'true')
      void this.tick();
  }
  async accept(event: RoomEvent) {
    const snapshot = await this.rooms.snapshot(event.roomId);
    const room = snapshot.rooms[0];
    // Do not acknowledge an event until its committed source version is visible.
    if (!room || room.version < event.version)
      throw new Error('Room source unavailable or behind event');
    event = { ...event, version: room.version, room };
    await this.database.transaction(async (manager) => {
      // Transaction-level lock serializes versions for one room across consumers.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [event.roomId],
      );
      const [seen] = await manager.query<{ exists: boolean }[]>(
        'SELECT EXISTS(SELECT 1 FROM mad_room_events WHERE event_id=$1) AS exists',
        [event.eventId],
      );
      if (seen.exists) return;
      const [last] = await manager.query<{ version: string }[]>(
        'SELECT version FROM mad_room_versions WHERE room_id=$1',
        [event.roomId],
      );
      const stale = last && Number(last.version) >= event.version;
      await manager.query(
        'INSERT INTO mad_room_events(event_id,room_id,version,payload,delivered_at) VALUES ($1,$2,$3,$4,CASE WHEN $5 THEN now() ELSE NULL END)',
        [
          event.eventId,
          event.roomId,
          event.version,
          JSON.stringify(event),
          Boolean(stale),
        ],
      );
      if (!stale)
        await manager.query(
          'UPDATE mad_room_events SET delivered_at=now() WHERE room_id=$1 AND version<$2 AND delivered_at IS NULL',
          [event.roomId, event.version],
        );
      if (!stale)
        await manager.query(
          'INSERT INTO mad_room_versions(room_id,version) VALUES ($1,$2) ON CONFLICT(room_id) DO UPDATE SET version=EXCLUDED.version',
          [event.roomId, event.version],
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
      this.gateway.roomsHealthy = false;
    });
    connection.on('close', () => {
      if (this.connection === connection) {
        this.connection = undefined;
        this.channel = undefined;
        this.gateway.roomsHealthy = false;
      }
    });
    const channel = await connection.createChannel();
    this.channel = channel;
    channel.on('error', () => {
      this.gateway.roomsHealthy = false;
    });
    channel.on('close', () => {
      if (this.channel === channel) {
        this.channel = undefined;
        this.gateway.roomsHealthy = false;
      }
    });
    await channel.assertExchange('hotel.events', 'topic', { durable: true });
    await channel.assertQueue('mad.rooms.dead', { durable: true });
    await channel.assertQueue('mad.rooms', {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': 'mad.rooms.dead',
      },
    });
    await channel.bindQueue('mad.rooms', 'hotel.events', 'room.status.changed');
    await channel.prefetch(1);
    await channel.consume(
      'mad.rooms',
      (message) => {
        if (!message) {
          this.gateway.roomsHealthy = false;
          void connection.close().catch(() => undefined);
          return;
        }
        let event: RoomEvent;
        try {
          if (message.content.length > 8192) throw new Error();
          event = parseRoomEvent(
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
              this.gateway.roomsHealthy = false;
              void connection.close().catch(() => undefined);
            },
          )
          .catch(() => {
            this.gateway.roomsHealthy = false;
          });
      },
      { noAck: false },
    );
  }
  async dispatch() {
    const rows = await this.database.query<
      { event_id: string; payload: RoomEvent }[]
    >(
      'SELECT event_id,payload FROM mad_room_events WHERE delivered_at IS NULL ORDER BY received_at,event_id LIMIT 100',
    );
    for (const row of rows) {
      await this.gateway.publishRoom(row.payload);
      await this.database.query(
        'UPDATE mad_room_events SET delivered_at=now() WHERE event_id=$1',
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
      this.gateway.roomsHealthy = Boolean(this.channel);
    } catch {
      this.gateway.roomsHealthy = false;
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
          this.gateway.roomsHealthy ? 250 : 5000,
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
