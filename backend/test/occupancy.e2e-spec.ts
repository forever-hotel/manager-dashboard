import { BOOKING_CLOCK } from '../src/analytics/booking-analytics.service';
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
import { OccupancyAnalyticsService } from '../src/analytics/occupancy-analytics.service';
import { configureHttp } from '../src/common/http';
import { migrate } from '../src/database/migrate';
import { seedLocalAuth } from './local-auth-fixture';

type Summary = Awaited<ReturnType<OccupancyAnalyticsService['calendar']>>;

describe('DDP-010 occupancy API with disposable PostgreSQL', () => {
  let admin: DataSource;
  let database: DataSource;
  let runtime: DataSource;
  let app: INestApplication<App>;
  let provider: Awaited<ReturnType<typeof seedLocalAuth>>;

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const name = 'ddp_occupancy_test_' + suffix;
  const role = 'ddp_occupancy_app_' + suffix;
  const secret = 'occupancy-test-only-secret-at-least-32-characters';

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
      readFileSync('test/fixtures/occupancy-reporting.sql', 'utf8'),
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
    }).overrideProvider(BOOKING_CLOCK).useValue(() => new Date('2026-09-26T18:30:00Z')).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  }, 60000);

  beforeEach(async () => {
    await database.query(
      'TRUNCATE hw_occupancy_rooms, hw_occupancy_allocations, hw_occupancy_maintenance',
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

  async function room(
    from = '2020-01-01',
    to: string | null = null,
    id = randomUUID(),
  ) {
    await database.query(
      'INSERT INTO hw_occupancy_rooms(room_id,active_from,active_to) VALUES ($1,$2,$3)',
      [id, from, to],
    );
    return id;
  }
  async function stay(
    roomId: string,
    from: string,
    to: string,
    status: string | null = 'CONFIRMED',
    id = randomUUID(),
  ) {
    await database.query(
      'INSERT INTO hw_occupancy_allocations(allocation_id,room_id,check_in_date,check_out_date,status) VALUES ($1,$2,$3,$4,$5)',
      [id, roomId, from, to, status],
    );
    return id;
  }
  async function maintenance(roomId: string, from: string, to: string) {
    await database.query(
      'INSERT INTO hw_occupancy_maintenance(room_id,start_date,end_date) VALUES ($1,$2,$3)',
      [roomId, from, to],
    );
  }
  function get(
    query = '?from=2026-09-27&to=2026-09-29',
    token = provider.issue('manager'),
  ) {
    return request(app.getHttpServer())
      .get('/mad/analytics/occupancy' + query)
      .set('Authorization', 'Bearer ' + token);
  }
  async function calendar(query?: string): Promise<Summary> {
    return (await get(query).expect(200)).body as Summary;
  }

  it('TC-DDP-010-AC1: counts overlapping physical rooms once and excludes checkout day', async () => {
    const first = await room();
    const second = await room();
    await room('2020-01-01', null, first); // Duplicate inventory join row.
    const allocation = await stay(first, '2026-09-26', '2026-09-28');
    await stay(first, '2026-09-26', '2026-09-28', 'CONFIRMED', allocation);
    await stay(first, '2026-09-27', '2026-09-29', 'CHECKED_IN');
    await stay(second, '2026-09-27', '2026-09-28', 'CHECKED_OUT');
    const result = await calendar();
    expect(result.dates).toEqual([
      { date: '2026-09-27', occupiedRooms: 2, eligibleRooms: 2, rate: 1 },
      { date: '2026-09-28', occupiedRooms: 1, eligibleRooms: 2, rate: 0.5 },
      { date: '2026-09-29', occupiedRooms: 0, eligibleRooms: 2, rate: 0 },
    ]);
    expect(result).toMatchObject({
      timezone: 'Asia/Colombo',
      rangeEndInclusive: true,
    });
    expect(result.freshness.sourceLatestUpdatedAt).toBe(
      '2026-09-26T12:00:00.000Z',
    );
    expect(Number.isNaN(Date.parse(result.freshness.queriedAt))).toBe(false);
    expect(
      await database.query(
        'SELECT COUNT(*)::int AS count FROM hw_occupancy_allocations',
      ),
    ).toEqual([{ count: 4 }]);
  });

  it('TC-DDP-010-AC1: uses current allocations and excludes cancelled, pending and unknown statuses', async () => {
    const first = await room();
    for (const status of ['CANCELLED', 'PENDING', 'UNKNOWN', null]) {
      await stay(first, '2026-09-27', '2026-09-30', status);
    }
    const allocation = await stay(first, '2026-09-27', '2026-09-30');
    expect((await calendar()).dates[0].occupiedRooms).toBe(1);
    await database.query(
      'UPDATE hw_occupancy_allocations SET status=$1 WHERE allocation_id=$2',
      ['CANCELLED', allocation],
    );
    expect(
      (await calendar()).dates.every((day) => day.occupiedRooms === 0),
    ).toBe(true);
    await database.query(
      'UPDATE hw_occupancy_allocations SET status=$1, check_in_date=$2, check_out_date=$3 WHERE allocation_id=$4',
      ['CONFIRMED', '2026-10-01', '2026-10-03', allocation],
    );
    expect(
      (await calendar()).dates.every((day) => day.occupiedRooms === 0),
    ).toBe(true);
  });

  it('TC-DDP-010-AC2: fills empty dates across leap day and year boundaries', async () => {
    await room();
    for (const [from, to, expected] of [
      ['2024-02-28', '2024-03-01', ['2024-02-28', '2024-02-29', '2024-03-01']],
      ['2026-12-31', '2027-01-01', ['2026-12-31', '2027-01-01']],
      ['2026-09-27', '2026-09-27', ['2026-09-27']],
    ] as const) {
      const result = await calendar(`?from=${from}&to=${to}`);
      expect(result.dates.map((day) => day.date)).toEqual(expected);
      expect(
        result.dates.every((day) => day.occupiedRooms === 0 && day.rate === 0),
      ).toBe(true);
    }
    expect(
      (await calendar('?from=2024-01-01&to=2024-12-31')).dates,
    ).toHaveLength(366);
  });

  it.each([
    '',
    '?from=2026-09-27',
    '?to=2026-09-27',
    '?from=2026-09-29&to=2026-09-27',
    '?from=2024-01-01&to=2025-01-01',
    '?from=2025-02-29&to=2025-03-01',
    '?from=2026-09-27T00:00:00Z&to=2026-09-29',
    '?from=0000-01-01&to=0000-01-02',
    '?from=2026-09-27&from=2026-09-28&to=2026-09-29',
    '?from=2026-09-27&to=2026-09-29&extra=1',
  ])(
    'TC-DDP-010-AC2: rejects invalid query %s without modifying source data',
    async (query) => {
      await room();
      expect((await get(query).expect(400)).body).toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(
        await database.query(
          'SELECT COUNT(*)::int AS count FROM hw_occupancy_rooms',
        ),
      ).toEqual([{ count: 1 }]);
    },
  );

  it('TC-DDP-010-AC3: excludes maintenance and inactive rooms on each date', async () => {
    const first = await room();
    const retired = await room('2020-01-01', '2026-09-28');
    const future = await room('2026-09-29');
    const inactive = await room('2020-01-01', '2026-09-27');
    for (const id of [first, retired, future, inactive, randomUUID()]) {
      await stay(id, '2026-09-27', '2026-09-30');
    }
    await maintenance(first, '2026-09-27', '2026-09-29');
    await maintenance(first, '2026-09-28', '2026-09-29');
    expect((await calendar()).dates).toEqual([
      { date: '2026-09-27', occupiedRooms: 1, eligibleRooms: 1, rate: 1 },
      { date: '2026-09-28', occupiedRooms: 0, eligibleRooms: 0, rate: null },
      { date: '2026-09-29', occupiedRooms: 2, eligibleRooms: 2, rate: 1 },
    ]);
  });

  it('TC-DDP-010-AC3: returns a null rate for an available empty inventory', async () => {
    const result = await calendar();
    expect(result.dates).toHaveLength(3);
    expect(
      result.dates.every(
        (day) =>
          day.eligibleRooms === 0 &&
          day.occupiedRooms === 0 &&
          day.rate === null,
      ),
    ).toBe(true);
    expect(result.freshness.sourceLatestUpdatedAt).toBeNull();
  });

  it('requires an active manager session with password change complete', async () => {
    expect(
      (
        await request(app.getHttpServer())
          .get('/mad/analytics/occupancy')
          .expect(401)
      ).body,
    ).toMatchObject({ code: 'UNAUTHENTICATED' });
    await get(undefined, 'malformed').expect(401);
    expect(
      (await get(undefined, provider.issue('worker')).expect(403)).body,
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(
      (await get(undefined, provider.issue('first-login')).expect(403))
        .body,
    ).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
  });

  it.each(['rooms', 'allocations', 'maintenance'])(
    'grants only read access to the %s reporting view',
    async (source) => {
      await expect(
        runtime.query(`SELECT * FROM mad_occupancy_${source}`),
      ).resolves.toEqual([]);
      await expect(
        runtime.query(`DELETE FROM mad_occupancy_${source}`),
      ).rejects.toMatchObject({ driverError: { code: '42501' } });
      await expect(
        runtime.query(`SELECT * FROM hw_occupancy_${source}`),
      ).rejects.toMatchObject({ driverError: { code: '42501' } });
    },
  );

  it.each(['rooms', 'allocations', 'maintenance'])(
    'returns 503 when %s is absent or unreadable',
    async (source) => {
      const view = `mad_occupancy_${source}`;
      await database.query(`REVOKE SELECT ON ${view} FROM "${role}"`);
      try {
        const response = await get().expect(503);
        expect(response.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
        expect(JSON.stringify(response.body)).not.toContain(view);
      } finally {
        await database.query(`GRANT SELECT ON ${view} TO "${role}"`);
      }
      await database.query(`ALTER VIEW ${view} RENAME TO unavailable_source`);
      try {
        await get().expect(503);
      } finally {
        await database.query(`ALTER VIEW unavailable_source RENAME TO ${view}`);
      }
    },
  );
  const alerts = (suffix = '', token = provider.issue('manager')) => request(app.getHttpServer())
    .get('/mad/analytics/low-booking-alerts' + suffix)
    .set('Authorization', 'Bearer ' + token);

  it('TC-DDP-011-AC1/AC2: returns low dates and excludes rates exactly at the threshold', async () => {
    const rooms = await Promise.all(Array.from({ length: 5 }, () => room()));
    await stay(rooms[0], '2026-09-27', '2026-10-11');
    await stay(rooms[1], '2026-09-28', '2026-10-11');
    const response = await alerts().expect(200);
    expect(response.body).toMatchObject({ from: '2026-09-27', to: '2026-10-10', threshold: 0.4, unavailableDates: [] });
    expect(response.body.alerts).toEqual([expect.objectContaining({ date: '2026-09-27', rate: 0.2, promotionSuggestion: expect.any(String) })]);
    expect(await database.query('SELECT count(*)::int AS count FROM hw_occupancy_allocations')).toEqual([{ count: 2 }]);
  });
  it('TC-DDP-011-AC2: marks all zero-capacity dates unavailable without promotions', async () => {
    const response = await alerts().expect(200);
    expect(response.body.alerts).toEqual([]);
    expect(response.body.unavailableDates).toHaveLength(14);
    expect(response.body.unavailableDates[0]).toMatchObject({ date: '2026-09-27', rate: null, reason: 'ZERO_ELIGIBLE_ROOMS' });
  });
  it('TC-DDP-011-AC3: returns 200 and an empty list when all days are fully booked', async () => {
    await stay(await room(), '2026-09-27', '2026-10-11');
    expect((await alerts().expect(200)).body.alerts).toEqual([]);
  });
  it('DDP-011 rejects parameters and unauthorized sessions without writes', async () => {
    await request(app.getHttpServer()).get('/mad/analytics/low-booking-alerts').expect(401);
    await alerts('', 'invalid').expect(401);
    await alerts('', provider.issue('worker')).expect(403);
    await alerts('', provider.issue('first-login')).expect(403);
    await alerts('?threshold=0.9').expect(400);
    await alerts('?from=2026-01-01').expect(400);
    expect(await database.query('SELECT count(*)::int AS count FROM hw_occupancy_allocations')).toEqual([{ count: 0 }]);
  });
  it('DDP-011 fails safely when reporting permission is removed', async () => {
    await database.query(`REVOKE SELECT ON mad_occupancy_rooms FROM "${role}"`);
    try {
      expect((await alerts().expect(503)).body).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable. Please retry.' });
    } finally {
      await database.query(`GRANT SELECT ON mad_occupancy_rooms TO "${role}"`);
    }
  });

});
