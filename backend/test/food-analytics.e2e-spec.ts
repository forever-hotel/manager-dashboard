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
import { BOOKING_CLOCK } from '../src/analytics/booking-analytics.service';
import { FoodAnalyticsController } from '../src/analytics/food-analytics.controller';
import { FoodAnalyticsService } from '../src/analytics/food-analytics.service';
import { seedLocalAuth } from './local-auth-fixture';
type Summary = Awaited<ReturnType<FoodAnalyticsService['summary']>>;
describe('DDP-023 food orders with disposable PostgreSQL', () => {
  let admin: DataSource,
    database: DataSource,
    app: INestApplication<App>,
    provider: Awaited<ReturnType<typeof seedLocalAuth>>;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12),
    name = 'ddp_food_test_' + suffix,
    role = 'ddp_food_app_' + suffix;
  const secret = 'food-integration-only-secret-at-least-32-characters';
  let clock = new Date('2026-10-19T06:00:00Z');
  const itemA = '11111111-1111-4111-8111-111111111111',
    itemB = '22222222-2222-4222-8222-222222222222';
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.includes('test'))
      throw new Error(
        'TEST_DATABASE_URL must identify a disposable test database',
      );
    admin = new DataSource({ type: 'postgres', url });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${name}"`);
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD 'integration-only' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
    const owner = new URL(url);
    owner.pathname = '/' + name;
    database = new DataSource({ type: 'postgres', url: owner.toString() });
    await database.initialize();
    await database.query(
      'CREATE TABLE staff_users(worker_id uuid PRIMARY KEY,password_hash text)',
    );
    await database.query(readSchemaSection('auth'));
    // Minimal reporting fixture: shared PK/FK/unique/quantity contracts, no guest data.
    await database.query(`CREATE TYPE food_order_status AS ENUM ('PLACED','IN_PREPARATION','READY','DELIVERED','CANCELLED');
      CREATE TABLE kms_menu_items(menu_item_id uuid PRIMARY KEY,name text NOT NULL);
      CREATE TABLE kms_food_orders(order_id uuid PRIMARY KEY,status food_order_status NOT NULL,placed_at timestamptz NOT NULL,updated_at timestamptz NOT NULL);
      CREATE TABLE kms_food_order_items(order_item_id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES kms_food_orders(order_id),menu_item_id uuid NOT NULL REFERENCES kms_menu_items(menu_item_id),name varchar(255) NOT NULL,quantity integer NOT NULL CHECK(quantity>0),updated_at timestamptz NOT NULL,UNIQUE(order_id,menu_item_id));
      GRANT SELECT(order_id,placed_at,status,updated_at) ON kms_food_orders TO "${role}";
      GRANT SELECT(order_id,menu_item_id,name,quantity,updated_at) ON kms_food_order_items TO "${role}";
      GRANT SELECT ON mad_revoked_sessions TO "${role}"`);
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
              INITIAL_MANAGER_EMAIL: '',
              INITIAL_MANAGER_PASSWORD: '',
            }),
          ],
        }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: owner.toString(),
          synchronize: false,
        }),
        AuthModule,
      ],
      controllers: [FoodAnalyticsController],
      providers: [
        FoodAnalyticsService,
        { provide: BOOKING_CLOCK, useValue: () => clock },
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  }, 60000);
  beforeEach(async () => {
    clock = new Date('2026-10-19T06:00:00Z');
    await database.query(
      'TRUNCATE kms_food_order_items,kms_food_orders,kms_menu_items',
    );
    await database.query(
      "INSERT INTO kms_menu_items VALUES ($1,'Current renamed item'),($2,'Another current name')",
      [itemA, itemB],
    );
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
  function get(
    query = 'period=day',
    token: string | null = provider.issue('manager'),
  ) {
    const req = request(app.getHttpServer()).get(
      '/mad/analytics/food-orders?' + query,
    );
    if (token) req.set('Authorization', 'Bearer ' + token);
    return req;
  }
  async function order(
    at: string,
    status = 'PLACED',
    items: { id: string; name: string; quantity: number }[] = [],
  ) {
    const id = randomUUID();
    await database.query('INSERT INTO kms_food_orders VALUES ($1,$2,$3,$3)', [
      id,
      status,
      at,
    ]);
    for (const item of items)
      await database.query(
        'INSERT INTO kms_food_order_items VALUES ($1,$2,$3,$4,$5,$6)',
        [randomUUID(), id, item.id, item.name, item.quantity, at],
      );
    return id;
  }
  it('TC-MAD-023-AC1: counts each order once, historical quantities and half-hour-offset peak hours', async () => {
    await order('2026-10-19T08:00:00+05:30', 'PLACED', [
      { id: itemA, name: 'Historical curry', quantity: 3 },
      { id: itemB, name: 'Tea', quantity: 2 },
    ]);
    await order('2026-10-19T08:30:00+05:30', 'DELIVERED', [
      { id: itemA, name: 'Historical curry', quantity: 2 },
    ]);
    await order('2026-10-19T09:00:00+05:30', 'READY');
    const response = await get().expect(200);
    const body = response.body as Summary;
    expect(body.total).toBe(3);
    expect(body.peakHours).toEqual([8]);
    expect(body.hours[8].count).toBe(2);
    expect(body.hours[9].count).toBe(1);
    expect(body.popularItems).toEqual([
      { menuItemId: itemA, name: 'Historical curry', quantity: 5 },
      { menuItemId: itemB, name: 'Tea', quantity: 2 },
    ]);
    expect(JSON.stringify(body)).not.toContain('Current renamed');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('TC-MAD-023-AC2: zero-fills an empty day/week/month and handles leap February', async () => {
    clock = new Date('2024-02-29T12:00:00Z');
    for (const [period, days] of [
      ['day', 1],
      ['week', 7],
      ['month', 29],
    ] as const) {
      const body = (await get('period=' + period).expect(200)).body as Summary;
      expect(body.total).toBe(0);
      expect(body.trend).toHaveLength(days);
      expect(body.trend.every((b) => b.count === 0)).toBe(true);
      expect(body.hours).toEqual(
        Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 })),
      );
      expect(body.peakHours).toEqual([]);
      expect(body.popularItems).toEqual([]);
    }
  });
  it('TC-MAD-023-AC2: sorts ties deterministically, preserving name variants of one item', async () => {
    await order('2026-10-19T08:00:00+05:30', 'PLACED', [
      { id: itemB, name: 'Alpha', quantity: 2 },
      { id: itemA, name: 'Alpha', quantity: 2 },
    ]);
    await order('2026-10-19T09:00:00+05:30', 'IN_PREPARATION', [
      { id: itemA, name: 'Beta', quantity: 2 },
    ]);
    const body = (await get().expect(200)).body as Summary;
    expect(body.peakHours).toEqual([8, 9]);
    expect(body.popularItems.map((i) => [i.name, i.menuItemId])).toEqual([
      ['Alpha', itemA],
      ['Alpha', itemB],
      ['Beta', itemA],
    ]);
  });
  it('TC-MAD-023-AC3: excludes cancelled orders from every metric and uses inclusive start/exclusive end', async () => {
    await order('2026-10-19T00:00:00+05:30', 'PLACED');
    await order('2026-10-18T23:59:59.999+05:30', 'PLACED');
    await order('2026-10-20T00:00:00+05:30', 'PLACED');
    await order('2026-10-19T12:00:00+05:30', 'CANCELLED', [
      { id: itemA, name: 'Cancelled item', quantity: 100 },
    ]);
    const body = (await get().expect(200)).body as Summary;
    expect(body.total).toBe(1);
    expect(body.hours[0].count).toBe(1);
    expect(body.popularItems).toEqual([]);
    expect(body.start).toBe('2026-10-18T18:30:00.000Z');
    expect(body.end).toBe('2026-10-19T18:30:00.000Z');
    expect(((await get('period=week').expect(200)).body as Summary).total).toBe(
      2,
    );
  });
  it('limits popular items to ten with deterministic cutoff', async () => {
    for (let i = 0; i < 12; i++) {
      const itemId = randomUUID();
      await database.query('INSERT INTO kms_menu_items VALUES ($1,$2)', [
        itemId,
        'Menu ' + i,
      ]);
      await order('2026-10-19T10:00:00+05:30', 'PLACED', [
        { id: itemId, name: 'Item ' + String(i).padStart(2, '0'), quantity: 1 },
      ]);
    }
    const body = (await get().expect(200)).body as Summary;
    expect(body.total).toBe(12);
    expect(body.popularItems).toHaveLength(10);
    expect(body.popularItems[9].name).toBe('Item 09');
  });
  it('validates periods and rejects unauthenticated/forbidden access without writes', async () => {
    const id = await order('2026-10-19T12:00:00+05:30');
    for (const query of [
      'period=year',
      'period=',
      'period=day&period=week',
      'period=day&extra=1',
    ])
      await get(query).expect(400);
    for (const [token, status] of [
      [null, 401],
      ['invalid', 401],
      [provider.issue('worker'), 403],
      [provider.issue('first-login'), 403],
    ] as const)
      await get('period=day', token).expect(status);
    expect(((await get('').expect(200)).body as Summary).period).toBe('day');
    expect(
      await database.query('SELECT order_id FROM kms_food_orders'),
    ).toEqual([{ order_id: id }]);
  });
  it('returns 503 instead of fabricated empty data when reporting access is denied', async () => {
    await database.query(
      `REVOKE SELECT(order_id,placed_at,status,updated_at) ON kms_food_orders FROM "${role}"`,
    );
    try {
      expect((await get().expect(503)).body as unknown).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable. Please retry.',
      });
    } finally {
      await database.query(
        `GRANT SELECT(order_id,placed_at,status,updated_at) ON kms_food_orders TO "${role}"`,
      );
    }
  });
});
