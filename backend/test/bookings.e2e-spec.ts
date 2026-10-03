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
import {
  BOOKING_CLOCK,
  BookingAnalyticsService,
} from '../src/analytics/booking-analytics.service';
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
      readFileSync('test/fixtures/booking-reporting.sql', 'utf8'),
    );
    await migrate(database, role);
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
              JWT_ISSUER: 'mad',
            }),
          ],
        }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: owner.toString(),
          synchronize: false,
          // Deliberately different from the hotel to detect implicit timezone use.
          extra: { options: '-c timezone=America/New_York' },
        }),
        AnalyticsModule,
      ],
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
    await database.query('TRUNCATE hw_booking_snapshots');
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

  async function seed(
    date: string,
    status = 'CONFIRMED',
    id = randomUUID(),
    updated = '2026-09-26T12:00:00Z',
  ) {
    await database.query(
      'INSERT INTO hw_booking_snapshots(booking_id,check_in_date,status,updated_at) VALUES ($1,$2,$3,$4)',
      [id, date, status, updated],
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
      end: '2026-09-27T18:30:00.000Z',
    });
    expect(result.trend).toHaveLength(1);
    expect(result.trend[0]).toMatchObject({ date: '2026-09-27', count: 1 });
    expect(result.freshness.sourceLatestUpdatedAt).toBe(
      '2026-09-26T12:00:00.000Z',
    );
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
    expect(result.trend.map((b) => b.date)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ]);
    expect(result.trend.map((b) => b.count)).toEqual([1, 0, 0, 0, 0, 0, 1]);
  });

  it.each([
    ['2024-02-15T04:00:00Z', '2024-02-01', '2024-02-29', '2024-03-01', 29],
    ['2025-02-15T04:00:00Z', '2025-02-01', '2025-02-28', '2025-03-01', 28],
    ['2026-12-15T04:00:00Z', '2026-12-01', '2026-12-31', '2027-01-01', 31],
  ])(
    'TC-DDP-009-AC1: respects month length for %s',
    async (instant, first, last, outside, size) => {
      clock = new Date(instant);
      await seed(first);
      await seed(last);
      await seed(outside);
      const result = await summary('month');
      expect(result.total).toBe(2);
      expect(result.trend).toHaveLength(size);
      expect(result.trend[0].date).toBe(first);
      expect(result.trend.at(-1)?.date).toBe(last);
    },
  );

  it.each([
    ['day', 1],
    ['week', 7],
    ['month', 30],
  ])('TC-DDP-009-AC2: zero-fills empty %s', async (period, size) => {
    const result = await summary(String(period));
    expect(result.total).toBe(0);
    expect(result.trend).toHaveLength(Number(size));
    expect(result.trend.every((b) => b.count === 0)).toBe(true);
    expect(result.freshness.sourceLatestUpdatedAt).toBeNull();
  });

  it.each([
    '?period=year',
    '?period=',
    '?period=DAY',
    '?period=day&period=week',
    '?unknown=value',
  ])('TC-DDP-009-AC2: rejects invalid query %s', async (query) => {
    const response = await get(query).expect(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

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
    expect(
      await database.query(
        'SELECT COUNT(*)::int AS count FROM hw_booking_snapshots',
      ),
    ).toEqual([{ count: 8 }]);
  });

  it('TC-DDP-009-AC3: deduplicates before date filtering and excludes tied cancellation', async () => {
    const rescheduled = await seed('2026-09-27');
    await seed('2026-10-01', 'CONFIRMED', rescheduled, '2026-09-26T13:00:00Z');
    const tie = await seed('2026-09-27');
    await seed('2026-09-27', 'CANCELLED', tie);
    expect((await summary('day')).total).toBe(0);
  });

  it('enforces authentication, manager permission and first-password-change gating', async () => {
    expect(
      (
        await request(app.getHttpServer())
          .get('/mad/analytics/bookings')
          .expect(401)
      ).body,
    ).toMatchObject({ code: 'UNAUTHENTICATED' });
    await get('', 'malformed').expect(401);
    expect(
      (await get('', provider.issue('worker')).expect(403)).body,
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(
      (await get('', provider.issue('first-login')).expect(403)).body,
    ).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
  });

  it('grants reporting SELECT without shared-table or view writes', async () => {
    await seed('2026-09-27');
    await expect(
      runtime.query('SELECT booking_id FROM mad_booking_analytics'),
    ).resolves.toHaveLength(1);
    await expect(
      runtime.query('DELETE FROM mad_booking_analytics'),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });
    await expect(
      runtime.query('SELECT * FROM hw_booking_snapshots'),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });
  });

  it('returns 503 instead of zero when the reporting source cannot be read', async () => {
    await database.query(
      `REVOKE SELECT ON mad_booking_analytics FROM "${role}"`,
    );
    try {
      const response = await get().expect(503);
      expect(response.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      expect(JSON.stringify(response.body)).not.toContain(
        'mad_booking_analytics',
      );
    } finally {
      await database.query(
        `GRANT SELECT ON mad_booking_analytics TO "${role}"`,
      );
    }
  });

  it('returns 503 when the reporting view has not been provisioned', async () => {
    await database.query(
      'ALTER VIEW mad_booking_analytics RENAME TO booking_view_unavailable',
    );
    try {
      await get().expect(503);
    } finally {
      await database.query(
        'ALTER VIEW booking_view_unavailable RENAME TO mad_booking_analytics',
      );
    }
  });
});
