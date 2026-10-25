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

import { ConfigService } from '@nestjs/config';
import { io, Socket } from 'socket.io-client';
import { connect } from 'amqplib';
import { StockAlertsService } from '../src/stock/stock-alerts.service';
import {
  StockEventsConsumer,
  STOCK_QUEUE_ARGUMENTS,
  STOCK_BINDING,
  STOCK_QUEUE,
  STOCK_DEAD_QUEUE
} from '../src/realtime/stock-events.consumer';
import { type StockEvent, type StockUpdate, type StockStatus } from '../src/stock/stock-event';
import { seedLocalAuth } from './local-auth-fixture';

describe('DDP-034 stock alerts and recovery with disposable PostgreSQL', () => {
  let admin: DataSource,
    database: DataSource,
    app: INestApplication<App>,
    provider: Awaited<ReturnType<typeof seedLocalAuth>>;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12),
    name = 'ddp_stock_test_' + suffix,
    role = 'ddp_stock_app_' + suffix;
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
    await database.query(`CREATE TYPE menu_item_stock_status AS ENUM ('AVAILABLE','LOW_STOCK','UNAVAILABLE','TEMPORARILY_DISABLED');
      CREATE TABLE kms_menu_items(menu_item_id uuid PRIMARY KEY,name varchar(255) NOT NULL,stock_status menu_item_stock_status NOT NULL,updated_at timestamptz NOT NULL);
      GRANT SELECT ON kms_menu_items,mad_revoked_sessions TO "${role}"`);
    await database.query(readSchemaSection('stock'));
    await database.query(`GRANT SELECT,INSERT,UPDATE ON mad_stock_alerts,mad_stock_events TO "${role}"`);
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
    await database.query('TRUNCATE kms_menu_items,mad_stock_alerts,mad_stock_events');
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
  const itemId = '67f4568c-89ab-4c12-b321-123456789012';
  async function add(status: StockStatus = 'LOW_STOCK') {
    await database.query("INSERT INTO kms_menu_items VALUES($1,'Soup',$2,'2026-10-21T00:00:00.123456Z')", [
      itemId,
      status
    ]);
  }
  async function event(status?: StockStatus): Promise<StockEvent> {
    const [row] = await database.query<{ version: string; status: StockStatus }[]>(
      'SELECT (extract(epoch FROM updated_at)*1000000)::bigint::text AS version,stock_status::text AS status FROM kms_menu_items WHERE menu_item_id=$1',
      [itemId]
    );
    return {
      eventId: randomUUID(),
      type: 'kitchen.stock.changed',
      menuItemId: itemId,
      stockStatus: status ?? row.status,
      version: Number(row.version),
      occurredAt: '2026-10-21T00:00:00.123456Z'
    };
  }
  async function source(status: StockStatus) {
    await database.query(
      "UPDATE kms_menu_items SET stock_status=$2,updated_at=updated_at+interval '1 second' WHERE menu_item_id=$1",
      [itemId, status]
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

  it('TC-MAD-034-AC1/AC2: persists once, coalesces versions and clears on recovery without source writes', async () => {
    await add();
    const service = app.get(StockAlertsService);
    const first = await event();
    await Promise.all([service.accept(first), service.accept(first)]);
    expect(await database.query('SELECT count(*)::integer AS count FROM mad_stock_alerts WHERE active')).toEqual([
      { count: 1 }
    ]);
    expect(await database.query('SELECT count(*)::integer AS count FROM mad_stock_events')).toEqual([{ count: 1 }]);
    await source('UNAVAILABLE');
    await service.accept(await event());
    await source('AVAILABLE');
    const recovery = await event();
    await service.accept(recovery);
    expect(
      await database.query('SELECT active,stock_status,cleared_at IS NOT NULL AS cleared FROM mad_stock_alerts')
    ).toEqual([{ active: false, stock_status: 'AVAILABLE', cleared: true }]);
    await service.accept({ ...first, eventId: randomUUID() });
    expect(await database.query('SELECT count(*)::integer AS count FROM mad_stock_alerts WHERE active')).toEqual([
      { count: 0 }
    ]);
    expect(
      await database.query("SELECT count(*)::integer AS count FROM mad_stock_events WHERE delivery_state='pending'")
    ).toEqual([{ count: 1 }]);
    const [row] = await database.query<{ payload: StockUpdate }[]>(
      "SELECT payload FROM mad_stock_events WHERE delivery_state='pending'"
    );
    expect(row.payload.alert).toMatchObject({
      active: false,
      stockStatus: 'AVAILABLE',
      version: recovery.version
    });
    await source('TEMPORARILY_DISABLED');
    await service.accept(await event());
    expect(await database.query('SELECT active,cleared_at FROM mad_stock_alerts')).toEqual([
      { active: true, cleared_at: null }
    ]);
    await expect(app.get(DataSource).query("UPDATE kms_menu_items SET stock_status='AVAILABLE'")).rejects.toThrow();
  });
  it('TC-MAD-034-AC2: recovery-first, restart, duplicate IDs and source failures never resurrect stale work', async () => {
    await add('AVAILABLE');
    const service = app.get(StockAlertsService);
    const recovery = await event();
    await service.accept(recovery);
    const restarted = new StockAlertsService(app.get(DataSource));
    await restarted.accept(recovery);
    const before = await database.query<unknown[]>('SELECT * FROM mad_stock_alerts');
    await expect(restarted.accept({ ...recovery, stockStatus: 'LOW_STOCK' })).rejects.toThrow('identity reused');
    await expect(
      service.accept({
        ...recovery,
        eventId: randomUUID(),
        version: recovery.version + 1
      })
    ).rejects.toThrow();
    await expect(
      service.accept({
        ...recovery,
        eventId: randomUUID(),
        stockStatus: 'LOW_STOCK'
      })
    ).rejects.toThrow();
    expect(await database.query('SELECT * FROM mad_stock_alerts')).toEqual(before);
    await database.query(`REVOKE SELECT ON kms_menu_items FROM "${role}"`);
    try {
      await service.accept(recovery);
      await expect(service.accept({ ...recovery, eventId: randomUUID() })).rejects.toThrow();
    } finally {
      await database.query(`GRANT SELECT ON kms_menu_items TO "${role}"`);
    }
    expect(await database.query('SELECT * FROM mad_stock_alerts')).toEqual(before);
  });
  it('TC-MAD-034-AC1: persisted socket work survives a dispatch failure and is emitted only to authorized sessions', async () => {
    await add();
    const service = app.get(StockAlertsService);
    const first = await event();
    await service.accept(first);
    const consumer = app.get(StockEventsConsumer);
    const gateway = app.get(RealtimeGateway);
    const publish = jest.spyOn(gateway, 'publishStock').mockRejectedValueOnce(new Error('offline'));
    await expect(consumer.dispatch()).rejects.toThrow();
    expect(
      await database.query("SELECT count(*)::integer AS count FROM mad_stock_events WHERE delivery_state='pending'")
    ).toEqual([{ count: 1 }]);
    publish.mockRestore();
    const client = await socket();
    try {
      const received = new Promise<StockUpdate>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Stock update not delivered')), 5000);
        client.once('stock.alert.changed', (value: StockUpdate) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
      await consumer.dispatch();
      expect((await received).alert).toMatchObject({
        menuItemId: itemId,
        name: 'Soup',
        active: true,
        stockStatus: 'LOW_STOCK'
      });
      expect(
        await database.query("SELECT count(*)::integer AS count FROM mad_stock_events WHERE delivery_state='published'")
      ).toEqual([{ count: 1 }]);
    } finally {
      client.disconnect();
    }
    for (const [token, status] of [
      [null, 401],
      ['bad', 401],
      [provider.issue('worker'), 403],
      [provider.issue('first-login'), 403]
    ] as const) {
      const req = request(app.getHttpServer()).post('/mad/realtime/ticket');
      if (token) req.set('Authorization', 'Bearer ' + token);
      await req.expect(status);
    }
  }, 15000);
  it('TC-MAD-034-AC3: confirms broker persistence, dead-letters poison work and bounds transient failures across redelivery', async () => {
    const url = process.env.TEST_RABBITMQ_URL;
    if (!url || new URL(url).pathname !== '/mad_test') throw new Error('Use isolated mad_test RabbitMQ vhost');
    await add();
    const first = await event();
    const config = app.get(ConfigService);
    config.set('RABBITMQ_URL', url);
    const connection = await connect(url);
    const channel = await connection.createConfirmChannel();
    const consumer = app.get(StockEventsConsumer);
    let client: Socket | undefined;
    try {
      await channel.assertExchange('hotel.events', 'topic', { durable: true });
      await channel.assertQueue(STOCK_DEAD_QUEUE, {
        durable: true,
        arguments: { 'x-queue-type': 'quorum', 'x-delivery-limit': -1 }
      });
      await channel.assertQueue(STOCK_QUEUE, {
        durable: true,
        arguments: STOCK_QUEUE_ARGUMENTS
      });
      await channel.bindQueue(STOCK_QUEUE, 'hotel.events', STOCK_BINDING);
      await channel.purgeQueue(STOCK_QUEUE);
      await channel.purgeQueue(STOCK_DEAD_QUEUE);
      config.set('MAD_REALTIME_ENABLED', 'true');
      consumer.onModuleInit();
      client = await socket();
      const received = new Promise<StockUpdate>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Broker stock update missing')), 10000);
        client!.once('stock.alert.changed', (value: StockUpdate) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
      channel.publish('hotel.events', STOCK_BINDING, Buffer.from(JSON.stringify(first)), {
        persistent: true,
        messageId: first.eventId
      });
      await channel.waitForConfirms();
      expect((await received).menuItemId).toBe(itemId);
      channel.publish('hotel.events', STOCK_BINDING, Buffer.from('invalid JSON'), { persistent: true });
      await channel.waitForConfirms();
      async function deadLetter(timeout: number) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const row = await channel.get(STOCK_DEAD_QUEUE, { noAck: false });
          if (row) {
            channel.ack(row);
            return row;
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        throw new Error('Stock dead-letter not delivered');
      }
      expect((await deadLetter(10000)).content.toString()).toBe('invalid JSON');
      const missing = {
        ...first,
        eventId: randomUUID(),
        menuItemId: randomUUID()
      };
      channel.publish('hotel.events', STOCK_BINDING, Buffer.from(JSON.stringify(missing)), {
        persistent: true,
        messageId: missing.eventId
      });
      await channel.waitForConfirms();
      const failed = await deadLetter(60000);
      const death = failed.properties.headers as {
        'x-death'?: { reason?: string }[];
      };
      expect(death['x-death']?.[0].reason).toBe('delivery_limit');
      expect(JSON.parse(failed.content.toString()) as unknown).toEqual(missing);
      expect(await database.query('SELECT count(*)::integer AS count FROM mad_stock_alerts WHERE active')).toEqual([
        { count: 1 }
      ]);
      expect(await database.query('SELECT count(*)::integer AS count FROM mad_stock_events')).toEqual([{ count: 1 }]);
    } finally {
      await consumer.onModuleDestroy();
      client?.disconnect();
      await channel.close();
      await connection.close();
    }
  }, 90000);
});
