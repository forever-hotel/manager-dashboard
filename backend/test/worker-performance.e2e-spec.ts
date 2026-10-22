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
import { WorkerPerformanceController } from '../src/analytics/worker-performance.controller';
import { WorkerPerformanceService } from '../src/analytics/worker-performance.service';
import { seedLocalAuth } from './local-auth-fixture';
type Summary = Awaited<ReturnType<WorkerPerformanceService['summary']>>;
describe('DDP-025 worker performance with disposable PostgreSQL', () => {
  let admin: DataSource,
    database: DataSource,
    app: INestApplication<App>,
    provider: Awaited<ReturnType<typeof seedLocalAuth>>;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12),
    name = 'ddp_worker_test_' + suffix,
    role = 'ddp_worker_app_' + suffix;
  const secret = 'worker-integration-only-secret-at-least-32-characters';
  let clock = new Date('2026-10-19T06:00:00Z');
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
    // Relax completion constraints only to test corrupt legacy timestamps.
    await database.query(`CREATE TYPE task_status AS ENUM ('UNASSIGNED','ASSIGNED','IN_PROGRESS','COMPLETED','ESCALATED');
      CREATE TYPE complaint_status AS ENUM ('SUBMITTED','UNDER_REVIEW','RESOLVED');
      CREATE TABLE wkms_tasks(task_id uuid PRIMARY KEY,assigned_worker_id uuid REFERENCES staff_users(worker_id),status task_status NOT NULL,submitted_at timestamptz NOT NULL,completed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE foss_complaints(complaint_id uuid PRIMARY KEY,referenced_worker_id uuid REFERENCES staff_users(worker_id),status complaint_status NOT NULL,submitted_at timestamptz NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
      GRANT SELECT(assigned_worker_id,status,submitted_at,completed_at,updated_at) ON wkms_tasks TO "${role}";
      GRANT SELECT(referenced_worker_id,status,submitted_at,updated_at) ON foss_complaints TO "${role}";
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
      controllers: [WorkerPerformanceController],
      providers: [
        WorkerPerformanceService,
        { provide: BOOKING_CLOCK, useValue: () => clock },
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  }, 60000);
  beforeEach(async () => {
    clock = new Date('2026-10-19T06:00:00Z');
    await database.query('TRUNCATE wkms_tasks,foss_complaints');
    await database.query(
      "DELETE FROM staff_users WHERE username LIKE 'report-%'",
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
      '/mad/analytics/worker-performance?' + query,
    );
    if (token) req.set('Authorization', 'Bearer ' + token);
    return req;
  }
  async function worker(active = true, staffRole = 'WORKER') {
    const id = randomUUID();
    await database.query(
      "INSERT INTO staff_users(worker_id,username,password_hash,role,is_active) VALUES ($1,$2,'fixture',$3,$4)",
      [id, 'report-' + id, staffRole, active],
    );
    return id;
  }
  async function task(
    id: string | null,
    submitted: string,
    completed: string | null,
    status = 'COMPLETED',
  ) {
    await database.query(
      'INSERT INTO wkms_tasks(task_id,assigned_worker_id,status,submitted_at,completed_at) VALUES ($1,$2,$3,$4,$5)',
      [randomUUID(), id, status, submitted, completed],
    );
  }
  async function complaint(
    id: string | null,
    status = 'SUBMITTED',
    submitted = '2026-09-01T00:00:00Z',
  ) {
    await database.query(
      'INSERT INTO foss_complaints(complaint_id,referenced_worker_id,status,submitted_at) VALUES ($1,$2,$3,$4)',
      [randomUUID(), id, status, submitted],
    );
  }
  it('TC-MAD-025-AC1/AC3: independently aggregates historical completions and current referenced complaints', async () => {
    const id = await worker();
    await task(id, '2026-10-18T23:00:00+05:30', '2026-10-19T01:00:00+05:30');
    await task(id, '2026-10-19T08:00:00+05:30', '2026-10-19T09:00:00+05:30');
    await task(id, '2026-09-01T08:00:00Z', '2026-09-01T09:00:00Z');
    await task(id, '2026-10-19T08:00:00Z', null, 'IN_PROGRESS');
    for (const status of [
      'SUBMITTED',
      'UNDER_REVIEW',
      'UNDER_REVIEW',
      'RESOLVED',
    ])
      await complaint(id, status);
    await complaint(null);
    await complaint(id, 'SUBMITTED', '2026-10-20T00:00:00Z');
    const response = await get('period=day&workerId=' + id).expect(200);
    const body = response.body as Summary;
    expect(body.workers).toHaveLength(1);
    expect(body.workers[0]).toMatchObject({
      workerId: id,
      completedTaskCount: 2,
      validDurationCount: 2,
      averageCompletionMinutes: 90,
      openComplaintCount: 3,
    });
    expect(response.headers['cache-control']).toBe('no-store');
    await database.query(
      "UPDATE foss_complaints SET status='RESOLVED' WHERE referenced_worker_id=$1",
      [id],
    );
    expect(
      ((await get('workerId=' + id).expect(200)).body as Summary).workers[0]
        .openComplaintCount,
    ).toBe(0);
  });
  it('TC-MAD-025-AC2: retains empty and inactive workers and promoted historical assignees', async () => {
    const inactive = await worker(false),
      promoted = await worker(true, 'RECEPTIONIST'),
      other = await worker(true, 'MANAGER');
    await task(promoted, '2026-09-01T00:00:00Z', '2026-09-01T01:00:00Z');
    const body = (await get().expect(200)).body as Summary;
    expect(body.workers.find((w) => w.workerId === inactive)).toMatchObject({
      isActive: false,
      completedTaskCount: 0,
      averageCompletionMinutes: null,
      openComplaintCount: 0,
    });
    expect(body.workers.find((w) => w.workerId === promoted)).toMatchObject({
      role: 'RECEPTIONIST',
      completedTaskCount: 0,
    });
    expect(body.workers.some((w) => w.workerId === other)).toBe(false);
    expect(body.workers.map((w) => w.workerId)).toEqual(
      body.workers.map((w) => w.workerId).sort(),
    );
    expect(
      ((await get('workerId=' + randomUUID()).expect(200)).body as Summary)
        .workers,
    ).toEqual([]);
  });
  it('uses local completion bounds and Monday weeks; handles leap months and invalid durations', async () => {
    const id = await worker();
    await task(id, '2026-10-18T23:00:00+05:30', '2026-10-19T00:00:00+05:30');
    await task(id, '2026-10-19T23:00:00+05:30', '2026-10-20T00:00:00+05:30');
    await task(id, '2026-10-18T20:00:00+05:30', '2026-10-18T23:59:59+05:30');
    let body = (await get('workerId=' + id).expect(200)).body as Summary;
    expect(body.start).toBe('2026-10-18T18:30:00.000Z');
    expect(body.end).toBe('2026-10-19T18:30:00.000Z');
    expect(body.workers[0].completedTaskCount).toBe(1);
    expect(
      ((await get('period=week&workerId=' + id).expect(200)).body as Summary)
        .workers[0].completedTaskCount,
    ).toBe(2);
    await task(id, '2026-10-19T10:00:00+05:30', '2026-10-19T09:00:00+05:30');
    await task(id, '2026-10-19T10:00:00+05:30', null);
    await task(
      id,
      '2026-10-19T08:00:00+05:30',
      '2026-10-19T09:00:00+05:30',
      'ASSIGNED',
    );
    body = (await get('workerId=' + id).expect(200)).body as Summary;
    expect(body.workers[0]).toMatchObject({
      completedTaskCount: 2,
      validDurationCount: 1,
      excludedDurationCount: 1,
      averageCompletionMinutes: 60,
      dataQuality: {
        status: 'WARNING',
        negativeDurationCount: 1,
        missingCompletionCount: 1,
        unexpectedCompletionCount: 1,
      },
    });
    clock = new Date('2024-02-29T12:00:00Z');
    body = (await get('period=month&workerId=' + id).expect(200))
      .body as Summary;
    expect(body.start).toBe('2024-01-31T18:30:00.000Z');
    expect(body.end).toBe('2024-02-29T18:30:00.000Z');
    expect(body.workers[0].averageCompletionMinutes).toBeNull();
  });
  it('TC-MAD-025-AC3: rejects invalid filters and unauthorized callers without changing source records', async () => {
    const id = await worker();
    await task(id, '2026-10-19T00:00:00Z', '2026-10-19T00:00:00Z');
    const before = await database.query<unknown[]>('SELECT * FROM wkms_tasks');
    for (const query of [
      'period=year',
      'period=',
      'period=day&period=week',
      'workerId=bad',
      'workerId=',
      'workerId=' + id + '&workerId=' + id,
      'extra=1',
    ])
      await get(query).expect(400);
    for (const [token, status] of [
      [null, 401],
      ['bad', 401],
      [provider.issue('worker'), 403],
      [provider.issue('first-login'), 403],
    ] as const)
      await get('', token).expect(status);
    expect(
      ((await get('workerId=' + id).expect(200)).body as Summary).workers[0]
        .averageCompletionMinutes,
    ).toBe(0);
    expect(await database.query('SELECT * FROM wkms_tasks')).toEqual(before);
  });
  it('returns a safe failure when WKMS reporting access is unavailable', async () => {
    await database.query(
      `REVOKE SELECT(assigned_worker_id,status,submitted_at,completed_at,updated_at) ON wkms_tasks FROM "${role}"`,
    );
    try {
      expect((await get().expect(503)).body as unknown).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable. Please retry.',
      });
    } finally {
      await database.query(
        `GRANT SELECT(assigned_worker_id,status,submitted_at,completed_at,updated_at) ON wkms_tasks TO "${role}"`,
      );
    }
  });
});
