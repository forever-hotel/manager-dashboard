import { readSchemaSection } from './schema-section';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuthModule } from '../src/auth/auth.module';
import { configureHttp } from '../src/common/http';
import { RealtimeModule } from '../src/realtime/realtime.module';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { RoomEventsConsumer } from '../src/realtime/room-events.consumer';
import { ConfigService } from '@nestjs/config';
import { io, Socket } from 'socket.io-client';
import { connect } from 'amqplib';
import { RoomsService } from '../src/rooms/rooms.service';
import { seedLocalAuth } from './local-auth-fixture';
type Summary = Awaited<ReturnType<RoomsService['snapshot']>>;
describe('DDP-027 room snapshots and updates with disposable PostgreSQL', () => {
  let admin: DataSource,
    database: DataSource,
    app: INestApplication<App>,
    provider: Awaited<ReturnType<typeof seedLocalAuth>>;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12),
    name = 'ddp_rooms_test_' + suffix,
    role = 'ddp_rooms_app_' + suffix;
  const secret = 'worker-integration-only-secret-at-least-32-characters';

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.includes('test'))
      throw new Error('TEST_DATABASE_URL must identify a disposable test database');
    admin = new DataSource({ type: 'postgres', url });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${name}"`);
    await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD 'integration-only' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    const owner = new URL(url);
    owner.pathname = '/' + name;
    database = new DataSource({ type: 'postgres', url: owner.toString() });
    await database.initialize();
    await database.query('CREATE TABLE staff_users(worker_id uuid PRIMARY KEY,password_hash text)');
    await database.query(readSchemaSection('auth'));
    await database.query(`CREATE TYPE room_status AS ENUM ('OCCUPIED','VACANT','UNDER_MAINTENANCE','REQUIRES_CLEANING');
      CREATE TABLE room_types(room_type_id uuid PRIMARY KEY,type_name text NOT NULL);
      CREATE TABLE rooms(room_number varchar(10) PRIMARY KEY,room_type_id uuid REFERENCES room_types(room_type_id),status room_status NOT NULL,updated_at timestamptz NOT NULL,floor integer NOT NULL DEFAULT 1);
      GRANT SELECT ON rooms,room_types,mad_revoked_sessions TO "${role}"`);
    await database.query(readSchemaSection('rooms'));
    await database.query(`GRANT SELECT,INSERT,UPDATE ON mad_room_versions,mad_room_events TO "${role}"`);
    provider = await seedLocalAuth(database, secret, role);
    owner.username = role;
    owner.password = 'integration-only';
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_SECRET: secret,
              JWT_ISSUER: 'mad',
              FRONTEND_URL: 'http://localhost:3000',
              MAD_REALTIME_ENABLED: 'false',
              INITIAL_MANAGER_EMAIL: '',
              INITIAL_MANAGER_PASSWORD: ''
            })
          ]
        }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: owner.toString(),
          synchronize: false
        }),
        AuthModule,
        RealtimeModule
      ]
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
  }, 60000);
  beforeEach(async () => {
    await database.query('TRUNCATE rooms,room_types,mad_room_events,mad_room_versions');
    await database.query("INSERT INTO room_types VALUES ('67f4568c-89ab-4c12-b321-123456789012','Deluxe')");
  });
  afterAll(async () => {
    await app?.close();
    if (database?.isInitialized) await database.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });
  function get(query = '', token: string | null = provider.issue('manager')) {
    const req = request(app.getHttpServer()).get('/mad/rooms/status?' + query);
    if (token) req.set('Authorization', 'Bearer ' + token);
    return req;
  }
  async function add(id: string, status = 'VACANT') {
    await database.query(
      "INSERT INTO rooms(room_number,room_type_id,status,updated_at) VALUES ($1,'67f4568c-89ab-4c12-b321-123456789012',$2,'2026-10-20T00:00:00.123456Z')",
      [id, status]
    );
  }
  async function socket() {
    const result = await request(app.getHttpServer())
      .post('/mad/realtime/ticket')
      .set('Authorization', 'Bearer ' + provider.issue('manager'))
      .expect(201);
    const client = io(await app.getUrl(), {
      path: '/mad/socket.io',
      transports: ['websocket'],
      auth: { ticket: (result.body as { ticket: string }).ticket },
      extraHeaders: { Origin: 'http://localhost:3000' },
      reconnection: false
    });
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    return client;
  }
  it('TC-MAD-027-AC1: exposes every room with its stable ID, type and all four mapped states', async () => {
    for (const [i, state] of ['OCCUPIED', 'VACANT', 'UNDER_MAINTENANCE', 'REQUIRES_CLEANING'].entries())
      await add(String(101 + i), state);
    const response = await get().expect(200);
    const body = response.body as Summary;
    expect(body.rooms.map(r => r.label)).toEqual(['Occupied', 'Vacant', 'Under Maintenance', 'Requires Cleaning']);
    expect(body.rooms.map(r => r.id)).toEqual(['101', '102', '103', '104']);
    expect(body.rooms[0]).toMatchObject({
      number: '101',
      floor: 1,
      type: 'Deluxe',
      version: Date.parse('2026-10-20T00:00:00.123Z') * 1000 + 456
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('rejects filters and unauthorized callers and never writes FDS source data', async () => {
    await add('101');
    const before = await database.query<unknown[]>('SELECT * FROM rooms');
    for (const query of ['status=VACANT', 'page=1', 'extra=1']) await get(query).expect(400);
    for (const [token, status] of [
      [null, 401],
      ['bad', 401],
      [provider.issue('worker'), 403],
      [provider.issue('first-login'), 403]
    ] as const)
      await get('', token).expect(status);
    await get().expect(200);
    expect(await database.query('SELECT * FROM rooms')).toEqual(before);
    await request(app.getHttpServer())
      .patch('/mad/rooms/101')
      .set('Authorization', 'Bearer ' + provider.issue('manager'))
      .send({ status: 'OCCUPIED' })
      .expect(404);
    await expect(app.get(DataSource).query("UPDATE rooms SET status='OCCUPIED'")).rejects.toThrow();
    const ticket = await request(app.getHttpServer())
      .post('/mad/realtime/ticket')
      .set('Authorization', 'Bearer ' + provider.issue('worker'));
    expect(ticket.status).toBe(403);
  });
  it('TC-MAD-027-AC3: distinguishes empty rooms from unavailable FDS data', async () => {
    expect(((await get().expect(200)).body as Summary).rooms).toEqual([]);
    await database.query(`REVOKE SELECT ON rooms FROM "${role}"`);
    try {
      expect((await get().expect(503)).body as unknown).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable. Please retry.'
      });
    } finally {
      await database.query(`GRANT SELECT ON rooms TO "${role}"`);
    }
  });
  it('TC-MAD-027-AC3: persists duplicates once and supersedes pending old room states', async () => {
    await add('101');
    const service = app.get(RoomEventsConsumer);
    const room = ((await get().expect(200)).body as Summary).rooms[0];
    const event = {
      eventId: randomUUID(),
      type: 'room.status.changed' as const,
      roomId: '101',
      version: room.version,
      occurredAt: room.updatedAt
    };
    await Promise.all([service.accept(event), service.accept(event)]);
    await database.query(
      "UPDATE rooms SET status='OCCUPIED',updated_at=updated_at+interval '1 second' WHERE room_number='101'"
    );
    const newer = ((await get().expect(200)).body as Summary).rooms[0];
    await service.accept({
      ...event,
      eventId: randomUUID(),
      version: newer.version
    });
    const restarted = new RoomEventsConsumer(
      app.get(ConfigService),
      database,
      app.get(RealtimeGateway),
      app.get(RoomsService)
    );
    await restarted.accept({ ...event, eventId: randomUUID() });
    const rows = await database.query<{ payload: { room: { status: string } } }[]>(
      'SELECT payload FROM mad_room_events WHERE delivered_at IS NULL'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.room.status).toBe('OCCUPIED');
    expect(await database.query('SELECT version FROM mad_room_versions')).toEqual([{ version: String(newer.version) }]);
    await expect(
      service.accept({
        ...event,
        eventId: randomUUID(),
        version: newer.version + 1
      })
    ).rejects.toThrow();
  });
  it('TC-MAD-027-AC2: publishes a committed authoritative room update through RabbitMQ to an authorized socket', async () => {
    const url = process.env.TEST_RABBITMQ_URL;
    if (!url || new URL(url).pathname !== '/mad_test')
      throw new Error('Use an isolated mad_test RabbitMQ virtual host');
    await add('101', 'REQUIRES_CLEANING');
    const room = ((await get().expect(200)).body as Summary).rooms[0];
    const config = app.get(ConfigService);
    config.set('RABBITMQ_URL', url);
    config.set('MAD_REALTIME_ENABLED', 'true');
    app.get(RoomEventsConsumer).onModuleInit();
    const connection = await connect(url);
    const channel = await connection.createConfirmChannel();
    let client: Socket | undefined;
    try {
      await channel.assertExchange('hotel.events', 'topic', { durable: true });
      await channel.assertQueue('mad.rooms', {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': 'mad.rooms.dead'
        }
      });
      await channel.bindQueue('mad.rooms', 'hotel.events', 'room.status.changed');
      client = await socket();
      const event = {
        eventId: randomUUID(),
        type: 'room.status.changed',
        roomId: '101',
        version: room.version,
        occurredAt: room.updatedAt
      };
      const received = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Room event not delivered')), 10000);
        client!.once('room.status.changed', (value: unknown) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
      channel.publish('hotel.events', 'room.status.changed', Buffer.from(JSON.stringify(event)), {
        persistent: true,
        messageId: event.eventId
      });
      await channel.waitForConfirms();
      expect(await received).toEqual({ ...event, room });
    } finally {
      client?.disconnect();
      await channel.close();
      await connection.close();
    }
  }, 20000);
});
