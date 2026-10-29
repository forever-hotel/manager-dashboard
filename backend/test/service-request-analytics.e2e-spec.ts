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
import { ServiceRequestAnalyticsController } from '../src/analytics/service-request-analytics.controller';
import { ServiceRequestAnalyticsService } from '../src/analytics/service-request-analytics.service';
import { seedLocalAuth } from './local-auth-fixture';
type Summary = Awaited<ReturnType<ServiceRequestAnalyticsService['summary']>>;
describe('DDP-024 service requests with disposable PostgreSQL', () => {
  let admin: DataSource,
    database: DataSource,
    app: INestApplication<App>,
    provider: Awaited<ReturnType<typeof seedLocalAuth>>;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12),
    name = 'ddp_request_test_' + suffix,
    role = 'ddp_request_app_' + suffix;
  const secret = 'request-integration-only-secret-at-least-32-characters';
  let clock = new Date('2026-10-19T06:00:00Z');
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
    // Deliberately allow timestamp inconsistencies to exercise corrupt legacy data.
    await database.query(`CREATE TYPE service_request_status AS ENUM ('SUBMITTED','ASSIGNED','IN_PROGRESS','COMPLETED');
      CREATE TABLE foss_service_requests(request_id uuid PRIMARY KEY,status service_request_status NOT NULL,submitted_at timestamptz NOT NULL,completed_at timestamptz,updated_at timestamptz NOT NULL,room_number varchar(10) DEFAULT '204',category text DEFAULT 'ROOM_CLEANING');
      CREATE TABLE wkms_tasks(service_request_id uuid UNIQUE,assigned_worker_id uuid);
      GRANT SELECT ON wkms_tasks TO "${role}";
      GRANT SELECT(request_id,status,submitted_at,completed_at,updated_at,room_number,category) ON foss_service_requests TO "${role}";
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
              INITIAL_MANAGER_PASSWORD: ''
            })
          ]
        }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: owner.toString(),
          synchronize: false
        }),
        AuthModule
      ],
      controllers: [ServiceRequestAnalyticsController],
      providers: [ServiceRequestAnalyticsService, { provide: BOOKING_CLOCK, useValue: () => clock }]
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  }, 60000);
  beforeEach(async () => {
    clock = new Date('2026-10-19T06:00:00Z');
    await database.query('TRUNCATE wkms_tasks,foss_service_requests');
  });
  afterAll(async () => {
    await app?.close();
    await provider?.close();
    if (database?.isInitialized) await database.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });
  function get(query = 'period=day', token: string | null = provider.issue('manager')) {
    const req = request(app.getHttpServer()).get('/mad/analytics/service-requests?' + query);
    if (token) req.set('Authorization', 'Bearer ' + token);
    return req;
  }
  async function add(status: string, submitted: string, completed: string | null = null) {
    await database.query(
      'INSERT INTO foss_service_requests(request_id,status,submitted_at,completed_at,updated_at) VALUES ($1,$2,$3,$4,$3)',
      [randomUUID(), status, submitted, completed]
    );
  }
  it('scopes both active and all requests to the selected period', async () => {
    await add('ASSIGNED', '2026-09-01T08:00:00+05:30');
    await add('COMPLETED', '2026-09-02T08:00:00+05:30', '2026-09-02T09:00:00+05:30');
    await add('SUBMITTED', '2026-10-19T08:00:00+05:30');
    await database.query(
      "INSERT INTO wkms_tasks(service_request_id,assigned_worker_id) SELECT request_id,$1 FROM foss_service_requests WHERE status='ASSIGNED'",
      [provider.ids.get('worker')]
    );
    const active = await request(app.getHttpServer())
      .get('/mad/analytics/service-requests/list?view=active&period=month&date=2026-09-01')
      .set('Authorization', 'Bearer ' + provider.issue('manager'))
      .expect(200);
    expect(active.body).toMatchObject({ total: 1, view: 'active' });
    const activeBody = active.body as Awaited<ReturnType<ServiceRequestAnalyticsService['list']>>;
    expect(activeBody.requests.find(item => item.status === 'ASSIGNED')?.assignee).toBe('Fixture Staff');
    const history = await request(app.getHttpServer())
      .get('/mad/analytics/service-requests/list?view=all&period=month&date=2026-09-01&pageSize=1')
      .set('Authorization', 'Bearer ' + provider.issue('manager'))
      .expect(200);
    expect(history.body).toMatchObject({ total: 2, pageSize: 1, view: 'all' });
    const historyBody = history.body as Awaited<ReturnType<ServiceRequestAnalyticsService['list']>>;
    expect(historyBody.requests).toHaveLength(1);
    expect(historyBody.requests[0]).toMatchObject({
      roomNumber: '204',
      category: 'ROOM_CLEANING',
      status: 'COMPLETED',
      assignee: null
    });
    const summary = await get('period=month&date=2026-09-01').expect(200);
    expect(summary.body).toMatchObject({ total: 2, backlog: { count: 2 } });
    await request(app.getHttpServer())
      .get('/mad/analytics/service-requests/list?page=0')
      .set('Authorization', 'Bearer ' + provider.issue('manager'))
      .expect(400);
    await request(app.getHttpServer()).get('/mad/analytics/service-requests/list').expect(401);
  });
  it('TC-MAD-024-AC1: distinguishes submitted cohort, completion cohort and all-date backlog', async () => {
    for (const state of ['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS']) await add(state, '2026-10-19T08:00:00+05:30');
    await add('COMPLETED', '2026-10-19T08:00:00+05:30', '2026-10-19T09:00:00+05:30');
    await add('COMPLETED', '2026-10-18T23:00:00+05:30', '2026-10-19T01:00:00+05:30');
    await add('ASSIGNED', '2026-09-01T08:00:00+05:30');
    await add('SUBMITTED', '2026-10-20T08:00:00+05:30');
    const response = await get().expect(200);
    const body = response.body as Summary;
    expect(body.total).toBe(4);
    expect(body.byStatus.map(b => b.count)).toEqual([1, 1, 1, 1]);
    expect(body.resolution).toMatchObject({
      completedCount: 2,
      validDurationCount: 2,
      averageMinutes: 90,
      unit: 'minutes'
    });
    expect(body.backlog.count).toBe(4);
    expect(body.dataQuality.status).toBe('OK');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('TC-MAD-024-AC2: returns null rather than zero without completions; zero duration remains valid', async () => {
    const empty = (await get().expect(200)).body as Summary;
    expect(empty.resolution).toMatchObject({
      completedCount: 0,
      validDurationCount: 0,
      averageMinutes: null
    });
    expect(empty.total).toBe(0);
    await add('COMPLETED', '2026-10-19T08:00:00+05:30', '2026-10-19T08:00:00+05:30');
    expect(((await get().expect(200)).body as Summary).resolution.averageMinutes).toBe(0);
  });
  it('TC-MAD-024-AC3: flags corrupt data and excludes negative durations without discarding valid completions', async () => {
    await add('COMPLETED', '2026-10-19T09:00:00+05:30', '2026-10-19T08:00:00+05:30');
    await add('COMPLETED', '2026-10-19T09:00:00+05:30');
    await add('IN_PROGRESS', '2026-10-19T09:00:00+05:30', '2026-10-19T10:00:00+05:30');
    let body = (await get().expect(200)).body as Summary;
    expect(body.resolution).toMatchObject({
      completedCount: 1,
      validDurationCount: 0,
      excludedCount: 1,
      averageMinutes: null
    });
    expect(body.dataQuality).toMatchObject({
      status: 'WARNING',
      negativeDurationCount: 1,
      missingCompletionCount: 1,
      unexpectedCompletionCount: 1
    });
    await add('COMPLETED', '2026-10-19T09:00:00+05:30', '2026-10-19T09:30:30+05:30');
    body = (await get().expect(200)).body as Summary;
    expect(body.resolution).toMatchObject({
      completedCount: 2,
      validDurationCount: 1,
      excludedCount: 1,
      averageMinutes: 30.5
    });
  });
  it('uses hotel-local boundaries, Monday weeks and zero-filled leap months', async () => {
    await add('SUBMITTED', '2026-10-19T00:00:00+05:30');
    await add('SUBMITTED', '2026-10-18T23:59:59.999+05:30');
    await add('SUBMITTED', '2026-10-20T00:00:00+05:30');
    const day = (await get().expect(200)).body as Summary;
    expect(day.total).toBe(1);
    expect(day.start).toBe('2026-10-18T18:30:00.000Z');
    expect(day.end).toBe('2026-10-19T18:30:00.000Z');
    const week = (await get('period=week').expect(200)).body as Summary;
    expect(week.total).toBe(2);
    expect(week.trend).toHaveLength(7);
    clock = new Date('2024-02-29T12:00:00Z');
    const month = (await get('period=month').expect(200)).body as Summary;
    expect(month.trend).toHaveLength(29);
    expect(month.trend.every(b => b.count === 0)).toBe(true);
  });
  it('validates periods and rejects unauthorized reads without altering records', async () => {
    await add('SUBMITTED', '2026-10-19T08:00:00+05:30');
    const before = await database.query<unknown[]>('SELECT * FROM foss_service_requests');
    for (const query of ['period=year', 'period=', 'period=day&period=month', 'period=day&extra=1'])
      await get(query).expect(400);
    for (const [token, status] of [
      [null, 401],
      ['invalid', 401],
      [provider.issue('worker'), 403],
      [provider.issue('first-login'), 403]
    ] as const)
      await get('period=day', token).expect(status);
    expect(((await get('').expect(200)).body as Summary).period).toBe('day');
    expect(await database.query('SELECT * FROM foss_service_requests')).toEqual(before);
  });
  it('fails safely if reporting access is missing', async () => {
    await database.query(
      `REVOKE SELECT(request_id,status,submitted_at,completed_at,updated_at) ON foss_service_requests FROM "${role}"`
    );
    try {
      expect((await get().expect(503)).body as unknown).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable. Please retry.'
      });
    } finally {
      await database.query(
        `GRANT SELECT(request_id,status,submitted_at,completed_at,updated_at,room_number,category) ON foss_service_requests TO "${role}"`
      );
    }
  });
});
