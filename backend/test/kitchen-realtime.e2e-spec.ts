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
import { RealtimeConsumer } from '../src/realtime/realtime.consumer';
import { ConfigService } from '@nestjs/config';
import { io, Socket } from 'socket.io-client';
import { connect } from 'amqplib';
import { KitchenController } from '../src/kitchen/kitchen.controller';
import { KitchenService } from '../src/kitchen/kitchen.service';
import { seedLocalAuth } from './local-auth-fixture';
type Summary = Awaited<ReturnType<KitchenService['snapshot']>>;
describe('DDP-026/039/041 kitchen with disposable PostgreSQL', () => {
  let admin: DataSource,
    database: DataSource,
    app: INestApplication<App>,
    provider: Awaited<ReturnType<typeof seedLocalAuth>>;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12),
    name = 'ddp_kitchen_test_' + suffix,
    role = 'ddp_kitchen_app_' + suffix;
  const secret = 'worker-integration-only-secret-at-least-32-characters';
  const clock = new Date('2026-10-19T06:00:00Z');
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
    await database.query(`CREATE TYPE food_order_status AS ENUM ('PLACED','IN_PREPARATION','READY','DELIVERED','CANCELLED');
      CREATE TABLE kms_food_orders(order_id uuid PRIMARY KEY,room_number varchar(10) NOT NULL,meal_period text NOT NULL,status food_order_status NOT NULL,placed_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,delivered_at timestamptz);
      CREATE TABLE kms_food_order_items(order_item_id uuid PRIMARY KEY,order_id uuid REFERENCES kms_food_orders(order_id),quantity integer NOT NULL CHECK(quantity>0));
      GRANT SELECT(order_id,room_number,meal_period,status,placed_at,updated_at,delivered_at) ON kms_food_orders TO "${role}";
      GRANT SELECT(order_id,quantity) ON kms_food_order_items TO "${role}";
      GRANT SELECT ON mad_revoked_sessions TO "${role}"`);
    await database.query(readSchemaSection('realtime'));
    await database.query(`GRANT SELECT,INSERT,UPDATE ON mad_realtime_events,mad_realtime_versions TO "${role}"`);
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
      ],
      controllers: [KitchenController],
      providers: [KitchenService, { provide: 'KITCHEN_CLOCK', useValue: () => clock }]
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
  }, 60000);
  beforeEach(async () => {
    await database.query('TRUNCATE kms_food_order_items,kms_food_orders,mad_realtime_events,mad_realtime_versions');
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
    const req = request(app.getHttpServer()).get('/mad/kitchen/orders?' + query);
    if (token) req.set('Authorization', 'Bearer ' + token);
    return req;
  }
  async function order(status: string, delivered: string | null = null) {
    const id = randomUUID();
    await database.query(
      "INSERT INTO kms_food_orders VALUES ($1,'101','LUNCH',$2,'2026-10-19T00:00:00Z','2026-10-19T01:00:00.123456Z',$3)",
      [id, status, delivered]
    );
    return id;
  }
  async function ticket(token = provider.issue('manager')) {
    const result = await request(app.getHttpServer())
      .post('/mad/realtime/ticket')
      .set('Authorization', 'Bearer ' + token)
      .expect(201);
    return (result.body as { ticket: string }).ticket;
  }
  async function socket(ticketValue: string, origin = 'http://localhost:3000'): Promise<Socket> {
    const client = io(await app.getUrl(), {
      path: '/mad/socket.io',
      transports: ['websocket'],
      auth: { ticket: ticketValue },
      extraHeaders: { Origin: origin },
      reconnection: false
    });
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', error => {
        client.disconnect();
        reject(error);
      });
    });
    return client;
  }
  it('TC-MAD-041-AC1: maps four states, independent item counts, stable pagination and delivered retention', async () => {
    const ids: string[] = [];
    for (const state of ['PLACED', 'IN_PREPARATION', 'READY', 'DELIVERED'])
      ids.push(await order(state, state === 'DELIVERED' ? '2026-10-19T02:00:00Z' : null));
    await order('DELIVERED', '2026-10-18T02:00:00Z');
    await order('CANCELLED');
    await database.query('INSERT INTO kms_food_order_items VALUES ($1,$2,2),($3,$2,3)', [
      randomUUID(),
      ids[0],
      randomUUID()
    ]);
    const response = await get('pageSize=100').expect(200);
    const body = response.body as Summary;
    expect(body.counts).toEqual({
      PLACED: 1,
      IN_PREPARATION: 1,
      READY: 1,
      DELIVERED: 1
    });
    expect(body.total).toBe(4);
    expect(body.orders.find(o => o.id === ids[0])?.itemCount).toBe(5);
    expect(body.orders[0].version).toBe(Date.parse('2026-10-19T01:00:00.123Z') * 1000 + 456);
    expect(body.orders.map(o => o.id)).toEqual([...ids].sort());
    expect(response.headers['cache-control']).toBe('no-store');
    expect(((await get('status=READY').expect(200)).body as Summary).orders.map(o => o.status)).toEqual(['READY']);
    const first = (await get('pageSize=2').expect(200)).body as Summary;
    const second = (await get('pageSize=2&page=2').expect(200)).body as Summary;
    expect(new Set([...first.orders, ...second.orders].map(o => o.id)).size).toBe(4);
  });
  it('TC-MAD-041-AC3: empty is valid; invalid/unauthorized requests never mutate sources', async () => {
    expect(((await get().expect(200)).body as Summary).orders).toEqual([]);
    const id = await order('PLACED');
    for (const query of [
      'status=NEW',
      'page=0',
      'pageSize=101',
      'pageSize=',
      'page=1&page=2',
      'page=1e2',
      'page=0x10',
      'pageSize=1.0',
      'extra=1'
    ])
      await get(query).expect(400);
    for (const [token, status] of [
      [null, 401],
      ['bad', 401],
      [provider.issue('worker'), 403],
      [provider.issue('first-login'), 403]
    ] as const) {
      await get('', token).expect(status);
      const req = request(app.getHttpServer()).post('/mad/realtime/ticket');
      if (token) req.set('Authorization', 'Bearer ' + token);
      await req.expect(status);
    }
    expect(await database.query('SELECT order_id,status FROM kms_food_orders')).toEqual([
      { order_id: id, status: 'PLACED' }
    ]);
  });
  it('TC-MAD-041-AC3: delivered orders without a completion timestamp cannot masquerade as zero activity', async () => {
    const id = await order('DELIVERED');
    const failed = await get().expect(503);
    expect(failed.body as unknown).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Service temporarily unavailable. Please retry.'
    });
    await database.query('UPDATE kms_food_orders SET delivered_at=$2 WHERE order_id=$1', [id, clock]);
    expect(((await get().expect(200)).body as Summary).counts.DELIVERED).toBe(1);
  });
  it('TC-MAD-041-AC1: delivered retention includes hotel midnight and asOf, excludes earlier/future deliveries', async () => {
    await order('DELIVERED', '2026-10-18T18:29:59.999999Z');
    await order('DELIVERED', '2026-10-18T18:30:00Z');
    await order('DELIVERED', clock.toISOString());
    await order('DELIVERED', '2026-10-19T06:00:00.000001Z');
    const result = (await get('status=DELIVERED&pageSize=1&page=3').expect(200)).body as Summary;
    expect(result.counts.DELIVERED).toBe(2);
    expect(result.total).toBe(2);
    expect(result.orders).toEqual([]);
    expect(Date.parse(result.deliveredSince)).toBe(Date.parse('2026-10-18T18:30:00Z'));
  });
  it('returns an explicit unavailable response when KMS access is denied', async () => {
    await database.query(`REVOKE SELECT(order_id,quantity) ON kms_food_order_items FROM "${role}"`);
    try {
      expect((await get().expect(503)).body as unknown).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable. Please retry.'
      });
    } finally {
      await database.query(`GRANT SELECT(order_id,quantity) ON kms_food_order_items TO "${role}"`);
    }
  });
  it('TC-MAD-039-AC1: accepts only one-use authorized same-origin socket tickets', async () => {
    await expect(socket('invalid')).rejects.toThrow();
    const once = await ticket();
    const client = await socket(once);
    client.disconnect();
    await expect(socket(once)).rejects.toThrow();
    await expect(socket(await ticket(), 'http://untrusted.invalid')).rejects.toThrow();
    const revoked = await ticket();
    await database.query('UPDATE staff_users SET session_version=session_version+1 WHERE worker_id=$1', [
      provider.ids.get('manager')
    ]);
    try {
      await expect(socket(revoked)).rejects.toThrow();
    } finally {
      await database.query('UPDATE staff_users SET session_version=0 WHERE worker_id=$1', [
        provider.ids.get('manager')
      ]);
    }
  });
  it('TC-MAD-039-AC2: persists duplicates and older versions safely across consumer instances', async () => {
    const consumer = app.get(RealtimeConsumer);
    const id = await order('PLACED');
    const event = {
      eventId: randomUUID(),
      type: 'kitchen.order.changed' as const,
      orderId: id,
      version: 2,
      occurredAt: '2026-10-19T01:00:00Z'
    };
    await Promise.all([consumer.accept(event), consumer.accept(event)]);
    await consumer.accept({ ...event, eventId: randomUUID(), version: 1 });
    const restarted = new RealtimeConsumer(app.get(ConfigService), database, app.get(RealtimeGateway));
    await restarted.accept(event);
    const rows = await database.query<{ version: string; delivered_at: Date | null }[]>(
      'SELECT version,delivered_at FROM mad_realtime_events ORDER BY version'
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].delivered_at).not.toBeNull();
    expect(rows[1].delivered_at).toBeNull();
    expect(await database.query('SELECT version FROM mad_realtime_versions')).toEqual([{ version: '2' }]);
  });
  it('TC-MAD-039-AC2: supersedes unsent older work durably and rejects conflicting IDs across restart', async () => {
    const consumer = app.get(RealtimeConsumer);
    const id = await order('PLACED');
    const first = {
      eventId: randomUUID(),
      type: 'kitchen.order.changed' as const,
      orderId: id,
      version: 1,
      occurredAt: '2026-10-19T01:00:00Z'
    };
    const latest = { ...first, eventId: randomUUID(), version: 2 };
    await consumer.accept(first);
    await consumer.accept(latest);
    const restarted = new RealtimeConsumer(app.get(ConfigService), database, app.get(RealtimeGateway));
    await restarted.accept(latest);
    await expect(restarted.accept({ ...latest, version: 3 })).rejects.toThrow('Conflicting event identity');
    expect(await database.query('SELECT version FROM mad_realtime_events WHERE delivered_at IS NULL')).toEqual([
      { version: '2' }
    ]);
    expect(await database.query('SELECT version FROM mad_realtime_versions')).toEqual([{ version: '2' }]);
    expect(await database.query('SELECT event_id FROM mad_realtime_events')).toHaveLength(2);
    const client = await socket(await ticket());
    try {
      const delivered = new Promise<unknown>(resolve => client.once('kitchen.order.changed', resolve));
      await restarted.dispatch();
      expect(await delivered).toEqual(latest);
      expect(await database.query('SELECT event_id FROM mad_realtime_events WHERE delivered_at IS NULL')).toEqual([]);
    } finally {
      client.disconnect();
    }
  });
  it('TC-MAD-039-AC1/041-AC2: sends a committed broker event over the real socket and reconciles source version', async () => {
    const url = process.env.TEST_RABBITMQ_URL;
    if (!url || new URL(url).pathname !== '/mad_test')
      throw new Error('TEST_RABBITMQ_URL must use the isolated mad_test virtual host');
    const config = app.get(ConfigService);
    config.set('RABBITMQ_URL', url);
    config.set('MAD_REALTIME_ENABLED', 'true');
    app.get(RealtimeConsumer).onModuleInit();
    const connection = await connect(url);
    const channel = await connection.createConfirmChannel();
    let client: Socket | undefined;
    try {
      await channel.assertExchange('hotel.events', 'topic', { durable: true });
      await channel.assertQueue('mad.kitchen', {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': 'mad.kitchen.dead'
        }
      });
      await channel.bindQueue('mad.kitchen', 'hotel.events', 'kitchen.order.changed');
      const id = await order('READY');
      const snapshot = (await get().expect(200)).body as Summary;
      const version = snapshot.orders[0].version;
      client = await socket(await ticket());
      const event = {
        eventId: randomUUID(),
        type: 'kitchen.order.changed',
        orderId: id,
        version,
        occurredAt: '2026-10-19T01:00:00.123456Z'
      };
      const received = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Event not delivered')), 10000);
        client!.once('kitchen.order.changed', (e: unknown) => {
          clearTimeout(timer);
          resolve(e);
        });
      });
      channel.publish('hotel.events', 'kitchen.order.changed', Buffer.from(JSON.stringify(event)), {
        persistent: true,
        contentType: 'application/json',
        messageId: event.eventId
      });
      await channel.waitForConfirms();
      expect(await received).toEqual(event);
      expect(((await get().expect(200)).body as Summary).orders[0]).toMatchObject({ id, status: 'READY', version });
    } finally {
      client?.disconnect();
      await channel.close();
      await connection.close();
    }
  }, 20000);
});
