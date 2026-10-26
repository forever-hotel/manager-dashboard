import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AnalyticsModule } from '../src/analytics/analytics.module';
import { BOOKING_CLOCK, BookingAnalyticsService } from '../src/analytics/booking-analytics.service';
import { configureHttp } from '../src/common/http';
import { migrate } from '../src/database/migrate';
import { seedLocalAuth } from './local-auth-fixture';

type Summary = Awaited<ReturnType<BookingAnalyticsService['summary']>>;

describe('DDP-009 booking API with disposable PostgreSQL', () => {
  let admin: DataSource;
  let database: DataSource;
  let runtime: DataSource;
  let app: INestApplication<App>;
  let provider: Awaited<ReturnType<typeof seedLocalAuth>>;
  let clock: Date;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const name = 'ddp_booking_test_' + suffix;
  const role = 'ddp_booking_app_' + suffix;
  const secret = 'booking-test-only-secret-at-least-32-characters';

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
    await database.query(readFileSync('test/fixtures/booking-reporting.sql', 'utf8'));
    await migrate(database, role);
    await database.query(`
      CREATE TABLE rooms(room_number text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE guests(guest_id uuid PRIMARY KEY,full_name text);
      CREATE TABLE room_types(room_type_id uuid PRIMARY KEY,type_name text);
      CREATE TABLE bookings(booking_id uuid PRIMARY KEY,guest_id uuid,room_type_id uuid,check_in_date date,check_out_date date,total_amount integer,source text,status text,created_at timestamptz DEFAULT now());
      CREATE TABLE mad_occupancy_rooms(room_id text,active_from date,active_to date,updated_at timestamptz DEFAULT now());
      CREATE TABLE mad_occupancy_allocations(room_id text,check_in_date date,check_out_date date,status text,updated_at timestamptz DEFAULT now());
      CREATE TABLE mad_occupancy_maintenance(room_id text,start_date date,end_date date,updated_at timestamptz DEFAULT now());
      GRANT SELECT ON rooms,guests,room_types,bookings,mad_occupancy_rooms,mad_occupancy_allocations,mad_occupancy_maintenance TO "${role}";
    `);
    await database.query(`CREATE TABLE payments(payment_id uuid PRIMARY KEY,booking_id uuid NOT NULL,
      amount integer NOT NULL CHECK(amount>0),payment_status text NOT NULL,paid_at timestamptz);
      GRANT SELECT ON payments TO "${role}"`);
    owner.username = role;
    owner.password = 'integration-only';
    runtime = new DataSource({ type: 'postgres', url: owner.toString() });
    await runtime.initialize();
    provider = await seedLocalAuth(database, secret, role);
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_SECRET: secret,
              JWT_ISSUER: 'mad'
            })
          ]
        }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: owner.toString(),
          synchronize: false,
          // Deliberately different from the hotel to detect implicit timezone use.
          extra: { options: '-c timezone=America/New_York' }
        }),
        AnalyticsModule
      ]
    })
      .overrideProvider(BOOKING_CLOCK)
      .useValue(() => clock)
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  }, 60000);

  beforeEach(async () => {
    clock = new Date('2026-09-27T04:00:00Z');
    await database.query(
      'TRUNCATE hw_booking_snapshots, payments,bookings,guests,room_types,rooms,mad_occupancy_rooms,mad_occupancy_allocations,mad_occupancy_maintenance'
    );
  });

  afterAll(async () => {
    await app?.close();
    if (runtime?.isInitialized) await runtime.destroy();
    if (database?.isInitialized) await database.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });

  async function seed(date: string, status = 'CONFIRMED', id = randomUUID(), updated = '2026-09-26T12:00:00Z') {
    await database.query(
      'INSERT INTO hw_booking_snapshots(booking_id,check_in_date,status,updated_at) VALUES ($1,$2,$3,$4)',
      [id, date, status, updated]
    );
    return id;
  }
  function get(query = '?period=day', token = provider.issue('manager')) {
    return request(app.getHttpServer())
      .get('/mad/analytics/bookings' + query)
      .set('Authorization', 'Bearer ' + token);
  }
  async function summary(period: string): Promise<Summary> {
    return (await get('?period=' + period).expect(200)).body as Summary;
  }

  it('TC-DDP-009-AC1: counts check-in dates with half-open day boundaries and hotel-local midnight', async () => {
    clock = new Date('2026-09-26T18:30:00Z'); // Midnight in Colombo, previous date in UTC.
    await seed('2026-09-26');
    await seed('2026-09-27');
    await seed('2026-09-28');
    const result = await summary('day');
    expect(result).toMatchObject({
      total: 1,
      start: '2026-09-26T18:30:00.000Z',
      end: '2026-09-27T18:30:00.000Z'
    });
    expect(result.trend).toHaveLength(1);
    expect(result.trend[0]).toMatchObject({ date: '2026-09-27', count: 1 });
    expect(result.freshness.sourceLatestUpdatedAt).toBe('2026-09-26T12:00:00.000Z');
    expect(Number.isNaN(Date.parse(result.freshness.queriedAt))).toBe(false);
  });

  it('TC-DDP-009-AC1: uses Monday weeks and includes scheduled upcoming check-ins', async () => {
    clock = new Date('2026-09-23T04:00:00Z');
    await seed('2026-09-20');
    await seed('2026-09-21');
    await seed('2026-09-27');
    await seed('2026-09-28');
    const result = await summary('week');
    expect(result.total).toBe(2);
    expect(result.trend.map(b => b.date)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27'
    ]);
    expect(result.trend.map(b => b.count)).toEqual([1, 0, 0, 0, 0, 0, 1]);
  });

  it.each([
    ['2024-02-15T04:00:00Z', '2024-02-01', '2024-02-29', '2024-03-01', 29],
    ['2025-02-15T04:00:00Z', '2025-02-01', '2025-02-28', '2025-03-01', 28],
    ['2026-12-15T04:00:00Z', '2026-12-01', '2026-12-31', '2027-01-01', 31]
  ])('TC-DDP-009-AC1: respects month length for %s', async (instant, first, last, outside, size) => {
    clock = new Date(instant);
    await seed(first);
    await seed(last);
    await seed(outside);
    const result = await summary('month');
    expect(result.total).toBe(2);
    expect(result.trend).toHaveLength(size);
    expect(result.trend[0].date).toBe(first);
    expect(result.trend.at(-1)?.date).toBe(last);
  });

  it.each([
    ['day', 1],
    ['week', 7],
    ['month', 30]
  ])('TC-DDP-009-AC2: zero-fills empty %s', async (period, size) => {
    const result = await summary(String(period));
    expect(result.total).toBe(0);
    expect(result.trend).toHaveLength(Number(size));
    expect(result.trend.every(b => b.count === 0)).toBe(true);
    expect(result.freshness.sourceLatestUpdatedAt).toBeNull();
  });

  it.each(['?period=year', '?period=', '?period=DAY', '?period=day&period=week', '?unknown=value'])(
    'TC-DDP-009-AC2: rejects invalid query %s',
    async query => {
      const response = await get(query).expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  );

  it('defaults an omitted period to day', async () => {
    expect((await get('').expect(200)).body).toMatchObject({ period: 'day' });
  });

  it('TC-DDP-009-AC3: applies latest status and deduplicates replayed source rows', async () => {
    const confirmed = await seed('2026-09-27');
    await seed('2026-09-27', 'CONFIRMED', confirmed);
    await seed('2026-09-27', 'CHECKED_IN');
    await seed('2026-09-27', 'CHECKED_OUT');
    await seed('2026-09-27', 'PENDING');
    await seed('2026-09-27', 'CANCELLED');
    const cancelled = await seed('2026-09-27');
    await seed('2026-09-27', 'CANCELLED', cancelled, '2026-09-26T13:00:00Z');
    const result = await summary('day');
    expect(result.total).toBe(3);
    expect(result.total).toBe(result.trend.reduce((n, b) => n + b.count, 0));
    expect(await database.query('SELECT COUNT(*)::int AS count FROM hw_booking_snapshots')).toEqual([{ count: 8 }]);
  });

  it('TC-DDP-009-AC3: deduplicates before date filtering and excludes tied cancellation', async () => {
    const rescheduled = await seed('2026-09-27');
    await seed('2026-10-01', 'CONFIRMED', rescheduled, '2026-09-26T13:00:00Z');
    const tie = await seed('2026-09-27');
    await seed('2026-09-27', 'CANCELLED', tie);
    expect((await summary('day')).total).toBe(0);
  });

  it('enforces authentication, manager permission and first-password-change gating', async () => {
    expect((await request(app.getHttpServer()).get('/mad/analytics/bookings').expect(401)).body).toMatchObject({
      code: 'UNAUTHENTICATED'
    });
    await get('', 'malformed').expect(401);
    expect((await get('', provider.issue('worker')).expect(403)).body).toMatchObject({ code: 'FORBIDDEN' });
    expect((await get('', provider.issue('first-login')).expect(403)).body).toMatchObject({
      code: 'PASSWORD_CHANGE_REQUIRED'
    });
  });

  it('grants reporting SELECT without shared-table or view writes', async () => {
    await seed('2026-09-27');
    await expect(runtime.query('SELECT booking_id FROM mad_booking_analytics')).resolves.toHaveLength(1);
    await expect(runtime.query('DELETE FROM mad_booking_analytics')).rejects.toMatchObject({
      driverError: { code: '42501' }
    });
    await expect(runtime.query('SELECT * FROM hw_booking_snapshots')).rejects.toMatchObject({
      driverError: { code: '42501' }
    });
  });

  it('returns 503 instead of zero when the reporting source cannot be read', async () => {
    await database.query(`REVOKE SELECT ON mad_booking_analytics FROM "${role}"`);
    try {
      const response = await get().expect(503);
      expect(response.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      expect(JSON.stringify(response.body)).not.toContain('mad_booking_analytics');
    } finally {
      await database.query(`GRANT SELECT ON mad_booking_analytics TO "${role}"`);
    }
  });

  it('returns 503 when the reporting view has not been provisioned', async () => {
    await database.query('ALTER VIEW mad_booking_analytics RENAME TO booking_view_unavailable');
    try {
      await get().expect(503);
    } finally {
      await database.query('ALTER VIEW booking_view_unavailable RENAME TO mad_booking_analytics');
    }
  });
  function analytics(path: string, period = 'day', session = provider.issue('manager')) {
    return request(app.getHttpServer())
      .get('/mad/analytics/' + path + '?period=' + period)
      .set('Authorization', 'Bearer ' + session);
  }
  async function payment(amount: number, paidAt: string | null, status = 'COMPLETED', booking = randomUUID()) {
    await database.query('INSERT INTO payments VALUES ($1,$2,$3,$4,$5)', [
      randomUUID(),
      booking,
      amount,
      status,
      paidAt
    ]);
  }
  it('TC-MAD-056-AC1/AC3: counts LKR cents once by paid_at and excludes refunded/failed/pending payments', async () => {
    clock = new Date('2026-09-27T04:00:00Z');
    const booking = randomUUID();
    await payment(10001, '2026-09-25T18:30:00Z');
    await payment(10001, '2026-09-26T18:30:00Z', 'COMPLETED', booking);
    await payment(10001, '2026-09-27T18:29:59Z', 'COMPLETED', booking);
    await payment(99999, '2026-09-27T18:30:00Z');
    for (const status of ['REFUNDED', 'FAILED', 'PENDING']) await payment(99999, '2026-09-27T04:00:00Z', status);
    const response = await analytics('revenue').expect(200);
    expect(response.body).toMatchObject({
      currency: 'LKR',
      currentMinor: 20002,
      previousMinor: 10001,
      percentageChange: 100,
      start: '2026-09-26T18:30:00.000Z',
      end: '2026-09-27T18:30:00.000Z'
    });
  });
  it.each(['day', 'week', 'month'])('TC-DDP-015-AC1: overview shares %s boundaries and timestamp', async period => {
    const response = await analytics('overview', period).expect(200);
    const result = response.body as {
      bookings: Summary;
      revenue: { start: string; end: string; asOf: string };
    };
    expect(result.bookings.start).toBe(result.revenue.start);
    expect(result.bookings.end).toBe(result.revenue.end);
    expect(result.bookings.asOf).toBe(result.revenue.asOf);
  });
  it('TC-MAD-056-AC2: empty source returns zero with an unavailable comparison, not an error', async () => {
    expect((await analytics('revenue').expect(200)).body).toMatchObject({
      currentMinor: 0,
      previousMinor: 0,
      percentageChange: null,
      percentageUnavailableReason: 'PREVIOUS_REVENUE_ZERO'
    });
    await payment(123, '2026-09-27T04:00:00Z');
    expect((await analytics('revenue').expect(200)).body).toMatchObject({
      currentMinor: 123,
      percentageChange: null
    });
  });
  it.each([
    [
      'week',
      '2026-01-01T00:00:00Z',
      '2025-12-28T18:30:00.000Z',
      '2025-12-21T18:30:00.000Z',
      '2026-01-04T18:30:00.000Z'
    ],
    [
      'month',
      '2028-02-20T00:00:00Z',
      '2028-01-31T18:30:00.000Z',
      '2027-12-31T18:30:00.000Z',
      '2028-02-29T18:30:00.000Z'
    ]
  ])(
    'TC-MAD-056-AC3: respects %s calendar boundaries across years/leap months',
    async (period, now, start, previousStart, end) => {
      clock = new Date(now);
      await payment(100, previousStart);
      await payment(125, start);
      expect((await analytics('revenue', period).expect(200)).body).toMatchObject({
        start,
        end,
        previousStart,
        currentMinor: 125,
        previousMinor: 100,
        percentageChange: 25
      });
    }
  );
  it('TC-MAD-056-AC1: preserves cents and rounds a negative comparison in PostgreSQL', async () => {
    clock = new Date('2026-09-27T04:00:00Z');
    await payment(300, '2026-09-25T18:30:00Z');
    await payment(100, '2026-09-26T18:30:00Z');
    await payment(900, '2026-09-25T18:30:00Z', 'REFUNDED');
    expect((await analytics('revenue').expect(200)).body).toMatchObject({
      currentMinor: 100,
      previousMinor: 300,
      percentageChange: -66.67,
      percentageUnavailableReason: null
    });
  });
  it.each(['revenue', 'overview'])('protects and validates %s without writing payment data', async path => {
    await request(app.getHttpServer())
      .get('/mad/analytics/' + path + '?period=day')
      .expect(401);
    await analytics(path, 'day', 'invalid').expect(401);
    await analytics(path, 'day', provider.issue('worker')).expect(403);
    await analytics(path, 'day', provider.issue('first-login')).expect(403);
    await analytics(path, 'year').expect(400);
    await analytics(path, 'day&extra=true').expect(400);
    expect(await database.query('SELECT * FROM payments')).toEqual([]);
  });
  it('rejects incomplete completed payments and denied source access instead of displaying zero', async () => {
    await payment(100, null);
    await analytics('revenue').expect(503);
    await database.query('TRUNCATE payments');
    await database.query(`REVOKE SELECT ON payments FROM "${role}"`);
    try {
      await analytics('revenue').expect(503);
      await analytics('overview').expect(503);
    } finally {
      await database.query(`GRANT SELECT ON payments TO "${role}"`);
    }
  });
  it('overview reads recent shared-schema booking rows and excludes cancellations from stay averages', async () => {
    const guest = randomUUID(),
      type = randomUUID();
    await database.query("INSERT INTO guests VALUES ($1,'Analytics guest')", [guest]);
    await database.query("INSERT INTO room_types VALUES ($1,'Analytics suite')", [type]);
    await database.query(
      `INSERT INTO bookings(booking_id,guest_id,room_type_id,check_in_date,check_out_date,total_amount,source,status) VALUES ($1,$3,$4,'2026-09-20','2026-09-22',4200000,'WEBSITE','CONFIRMED'),($2,$3,$4,'2026-09-21','2026-09-29',8000000,'WALK_IN','CANCELLED')`,
      [randomUUID(), randomUUID(), guest, type]
    );
    const response = await analytics('overview', 'month').expect(200);
    const body = response.body as {
      averageLengthOfStay: number;
      recentBookings: { guestName: string; roomType: string; status: string }[];
    };
    expect(body.averageLengthOfStay).toBe(2);
    expect(body.recentBookings).toHaveLength(2);
    expect(body.recentBookings[0]).toMatchObject({
      guestName: 'Analytics guest',
      roomType: 'Analytics suite',
      status: 'CANCELLED'
    });
  });
  it('supports a historical calendar month with fresh reporting timestamps', async () => {
    await seed('2026-08-15');
    await seed('2026-09-27');
    const response = await get('?period=month&date=2026-08-01').expect(200);
    const body = response.body as Summary;
    expect(body.total).toBe(1);
    expect(body.start).toBe('2026-07-31T18:30:00.000Z');
    expect(body.end).toBe('2026-08-31T18:30:00.000Z');
    expect(body.asOf).toBe(clock.toISOString());
  });
  it('paginates booking records instead of silently stopping at five', async () => {
    const type = randomUUID();
    await database.query("INSERT INTO room_types VALUES ($1,'Suite')", [type]);
    for (let i = 0; i < 7; i++)
      await database.query(
        "INSERT INTO bookings(booking_id,room_type_id,check_in_date,check_out_date,total_amount,source,status) VALUES ($1,$2,'2026-09-27','2026-09-29',4200000,'WEBSITE','PENDING')",
        [randomUUID(), type]
      );
    const response = await request(app.getHttpServer())
      .get('/mad/analytics/overview?period=month&date=2026-09-01&page=2')
      .set('Authorization', 'Bearer ' + provider.issue('manager'))
      .expect(200);
    const body = response.body as {
      bookingList: { total: number; page: number; pageSize: number };
      recentBookings: unknown[];
    };
    expect(body.bookingList).toEqual({ total: 7, page: 2, pageSize: 5 });
    expect(body.recentBookings).toHaveLength(2);
  });
});
