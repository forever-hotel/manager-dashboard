import { readSchemaSection } from './schema-section';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { configureHttp } from '../src/common/http';
import { ComplaintsModule } from '../src/complaints/complaints.module';
import { COMPLAINT_CLOCK } from '../src/complaints/complaints.service';
import { seedLocalAuth } from './local-auth-fixture';

describe('DDP-021 complaints with disposable PostgreSQL', () => {
  let admin: DataSource, database: DataSource, app: INestApplication<App>;
  let provider: Awaited<ReturnType<typeof seedLocalAuth>>;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const name = 'ddp_complaint_test_' + suffix,
    role = 'ddp_complaint_app_' + suffix,
    guestRole = 'ddp_complaint_guest_' + suffix;
  const secret = 'complaint-integration-only-secret-32-characters';
  const id = randomUUID(),
    otherId = randomUUID();
  const now = new Date('2026-10-16T12:00:00Z');
  const patch = {
    version: 0,
    status: 'UNDER_REVIEW',
    note: 'Private investigation note'
  };

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;

    if (!url || !new URL(url).pathname.includes('test'))
      throw new Error('TEST_DATABASE_URL must identify a disposable test database');
    admin = new DataSource({ type: 'postgres', url });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${name}"`);
    await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD 'integration-only' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    await admin.query(`CREATE ROLE "${guestRole}" NOLOGIN NOSUPERUSER`);
    const owner = new URL(url);

    owner.pathname = '/' + name;
    database = new DataSource({ type: 'postgres', url: owner.toString() });
    await database.initialize();
    await database.query('CREATE TABLE staff_users(worker_id uuid PRIMARY KEY, password_hash text)');
    await database.query(readSchemaSection('auth'));
    // Shared-schema complaint subset; unrelated booking/order/request FKs are
    // outside this fixture. Privacy, status, worker FK and resolution invariant match.
    await database.query(`CREATE TYPE complaint_status AS ENUM ('SUBMITTED','UNDER_REVIEW','RESOLVED');
      CREATE TABLE foss_complaints(complaint_id uuid PRIMARY KEY, category varchar(100) NOT NULL,room_number varchar(10) NOT NULL DEFAULT '204',severity text NOT NULL DEFAULT 'HIGH',
      description text NOT NULL, referenced_worker_id uuid REFERENCES staff_users(worker_id),
      status complaint_status NOT NULL DEFAULT 'SUBMITTED', resolution_notes text,
      submitted_at timestamptz NOT NULL, resolved_at timestamptz,
      CHECK ((status='RESOLVED' AND resolved_at IS NOT NULL) OR (status<>'RESOLVED' AND resolved_at IS NULL)))`);
    await database.query(readSchemaSection('complaints'));
    await database.query(`GRANT SELECT ON mad_revoked_sessions TO "${role}";
      GRANT SELECT(complaint_id,room_number,severity,category,description,referenced_worker_id,submitted_at,status,resolved_at),UPDATE(status,resolved_at) ON foss_complaints TO "${role}";
      GRANT SELECT,INSERT,UPDATE ON mad_complaint_state TO "${role}";
      GRANT SELECT,INSERT ON mad_complaint_history TO "${role}";
      GRANT INSERT ON mad_complaint_outbox TO "${role}";
      GRANT SELECT ON foss_complaints TO "${guestRole}"`);
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
        ComplaintsModule
      ]
    })
      .overrideProvider(COMPLAINT_CLOCK)
      .useValue(() => now)
      .compile();

    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  }, 60000);
  beforeEach(async () => {
    await database.query('TRUNCATE mad_complaint_outbox,mad_complaint_history,mad_complaint_state,foss_complaints');
    await database.query(
      `INSERT INTO foss_complaints(complaint_id,category,description,referenced_worker_id,submitted_at)
      VALUES ($1,'Room','Guest description',NULL,'2026-10-15T10:00:00Z'),($2,'Food','Cold meal',$3,'2026-10-15T09:00:00Z')`,
      [id, otherId, provider.ids.get('worker')]
    );
  });
  afterAll(async () => {
    await app?.close();
    await provider?.close();
    if (database?.isInitialized) await database.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.query(`DROP ROLE IF EXISTS "${guestRole}"`);
      await admin.destroy();
    }
  });
  function call(method: 'get' | 'patch', path = '', body?: object, token: string | null = provider.issue('manager')) {
    const req = request(app.getHttpServer())[method]('/mad/complaints' + path);

    if (token) req.set('Authorization', 'Bearer ' + token);
    return body ? req.send(body) : req;
  }
  async function snapshot() {
    return {
      rows: await database.query<unknown[]>('SELECT * FROM foss_complaints ORDER BY complaint_id'),
      state: await database.query<unknown[]>('SELECT * FROM mad_complaint_state ORDER BY complaint_id'),
      history: await database.query<unknown[]>('SELECT * FROM mad_complaint_history ORDER BY complaint_id,version'),
      events: await database.query<unknown[]>('SELECT * FROM mad_complaint_outbox ORDER BY complaint_id,version')
    };
  }
  it('TC-MAD-021-AC1: lists safe filtered/paginated complaints including a null worker', async () => {
    const result = await call('get', '?pageSize=1').expect(200);

    expect(result.body as unknown).toMatchObject({
      total: 2,
      page: 1,
      items: [
        {
          id,
          category: 'Room',
          description: 'Guest description',
          referencedWorkerId: null,
          status: 'SUBMITTED',
          version: 0,
          submittedAt: '2026-10-15T10:00:00.000Z'
        }
      ]
    });
    expect(result.headers['cache-control']).toBe('no-store');
    const filtered = await call('get', '?status=SUBMITTED&category=Food&workerId=' + provider.ids.get('worker')).expect(
      200
    );

    expect(filtered.body as unknown).toMatchObject({
      total: 1,
      items: [{ id: otherId }]
    });
    expect((await call('get', '?page=2&pageSize=1').expect(200)).body as unknown).toMatchObject({
      items: [{ id: otherId }]
    });
    expect((await call('get', '?status=RESOLVED').expect(200)).body as unknown).toMatchObject({ items: [], total: 0 });
  });
  it('filters the register to a hotel-calendar period and reports resolution metrics', async () => {
    const october = await call('get', '?period=month&date=2026-10-01').expect(200);

    expect(october.body as unknown).toMatchObject({
      total: 2,
      summary: { open: 2, review: 0, resolved: 0, averageMinutes: null },
      items: [{ roomNumber: '204', severity: 'HIGH' }, { workerName: 'Fixture Staff' }]
    });
    const september = await call('get', '?period=month&date=2026-09-01').expect(200);

    expect(september.body as unknown).toMatchObject({ total: 0, items: [], summary: { open: 0, review: 0 } });
    await call('patch', '/' + id, patch).expect(200);
    await call('patch', '/' + id, { ...patch, version: 1, status: 'RESOLVED' }).expect(200);
    const resolved = await call('get', '?period=month&date=2026-10-01').expect(200);

    expect(resolved.body as unknown).toMatchObject({ summary: { open: 1, review: 0, resolved: 1 } });
    await call('get', '?period=year').expect(400);
    await call('get', '?period=month&date=2026-02-30').expect(400);
    await call('get', '?date=2026-10-01').expect(400);
  });
  it('TC-MAD-021-AC2: records actor/time, both transitions, private notes and note-free events', async () => {
    await call('patch', '/' + id, patch).expect(200);
    const resolved = await call('patch', '/' + id, {
      version: 1,
      status: 'RESOLVED',
      note: 'Private final note'
    }).expect(200);

    expect(resolved.body as unknown).toMatchObject({
      id,
      status: 'RESOLVED',
      version: 2,
      resolvedAt: now.toISOString()
    });
    const detail = await call('get', '/' + id).expect(200);

    expect(detail.body as unknown).toMatchObject({
      status: 'RESOLVED',
      history: [
        {
          note: patch.note,
          actorId: provider.ids.get('manager'),
          recordedAt: now.toISOString()
        },
        { note: 'Private final note', version: 2 }
      ]
    });
    const all = await snapshot();

    expect(all.events).toHaveLength(2);
    expect(JSON.stringify(all.events)).not.toContain('Private');
    expect(JSON.stringify((await call('get').expect(200)).body)).not.toContain('Private');
    const [shared] = await database.query<{ resolution_notes: null; description: string }[]>(
      'SELECT resolution_notes,description FROM foss_complaints WHERE complaint_id=$1',
      [id]
    );

    expect(shared).toEqual({
      resolution_notes: null,
      description: 'Guest description'
    });
    const runner = database.createQueryRunner();

    await runner.connect();
    try {
      await runner.query(`SET ROLE "${guestRole}"`);
      expect(JSON.stringify(await runner.query('SELECT * FROM foss_complaints'))).not.toContain('Private');
      for (const table of ['mad_complaint_history', 'mad_complaint_state', 'mad_complaint_outbox'])
        await expect(runner.query('SELECT * FROM ' + table)).rejects.toMatchObject({ driverError: { code: '42501' } });
    } finally {
      await runner.query('RESET ROLE');
      await runner.release();
    }
  });
  it('TC-MAD-021-AC3: rejects unknown, invalid and stale transitions with no failed-write side effects', async () => {
    const before = await snapshot();

    await call('get', '/' + randomUUID()).expect(404);
    await call('patch', '/' + randomUUID(), patch).expect(404);
    await call('patch', '/' + id, { ...patch, status: 'RESOLVED' }).expect(400);
    await call('patch', '/' + id, { ...patch, version: 3 }).expect(409);
    expect(await snapshot()).toEqual(before);
    await call('patch', '/' + id, patch).expect(200);
    const saved = await snapshot();

    await call('patch', '/' + id, patch).expect(409);
    await call('patch', '/' + id, { ...patch, version: 1 }).expect(400);
    expect(await snapshot()).toEqual(saved);
    await call('patch', '/' + id, {
      ...patch,
      version: 1,
      status: 'RESOLVED'
    }).expect(200);
    await call('patch', '/' + id, { ...patch, version: 2 }).expect(400);
  });
  it('allows exactly one concurrent writer for a version', async () => {
    const results = await Promise.all([call('patch', '/' + id, patch), call('patch', '/' + id, patch)]);

    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const saved = await snapshot();

    expect(saved.history).toHaveLength(1);
    expect(saved.events).toHaveLength(1);
  });
  it('rejects invalid filters, payloads and unauthorized access without writes', async () => {
    const before = await snapshot();

    for (const query of ['page=0', 'page=1&page=2', 'pageSize=101', 'status=BAD', 'workerId=bad', 'extra=1'])
      await call('get', '?' + query).expect(400);
    await call('get', '/bad').expect(400);
    await call('patch', '/bad', patch).expect(400);
    for (const change of [
      { note: '' },
      { note: 'x'.repeat(4001) },
      { version: -1 },
      { version: '0' },
      { actorId: randomUUID() },
      { description: 'overwrite' },
      { status: 'SUBMITTED' }
    ])
      await call('patch', '/' + id, { ...patch, ...change }).expect(400);
    for (const [token, status] of [
      [null, 401],
      ['invalid', 401],
      [provider.issue('worker'), 403],
      [provider.issue('first-login'), 403]
    ] as const) {
      await call('get', '', undefined, token).expect(status);
      await call('get', '/' + id, undefined, token).expect(status);
      await call('patch', '/' + id, patch, token).expect(status);
    }
    expect(await snapshot()).toEqual(before);
  });
  it('rolls back owner fields, version and notes when durable event insertion fails', async () => {
    const before = await snapshot();

    await database.query(`REVOKE INSERT ON mad_complaint_outbox FROM "${role}"`);
    try {
      const response = await call('patch', '/' + id, patch).expect(503);

      expect(response.body as unknown).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable. Please retry.'
      });
      expect(await snapshot()).toEqual(before);
    } finally {
      await database.query(`GRANT INSERT ON mad_complaint_outbox TO "${role}"`);
    }
  });
});
