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
import { SettingsModule } from '../src/settings/settings.module';
import { seedLocalAuth } from './local-auth-fixture';
import { applyWkmsTaskLimit, claimWkmsTask } from './fixtures/wkms-task-limit-contract';
describe('DDP-045 policy API and reference WKMS handoff on disposable PostgreSQL', () => {
  let admin: DataSource,
    database: DataSource,
    wkms: DataSource,
    app: INestApplication<App>,
    provider: Awaited<ReturnType<typeof seedLocalAuth>>;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12),
    name = 'ddp_policy_test_' + suffix,
    role = 'ddp_policy_app_' + suffix,
    wkmsRole = 'ddp_policy_wkms_' + suffix;
  const secret = 'policy-integration-only-secret-at-least-32-characters';
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.includes('test'))
      throw new Error('Use a disposable TEST_DATABASE_URL containing test');
    admin = new DataSource({ type: 'postgres', url });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${name}"`);
    for (const principal of [role, wkmsRole])
      await admin.query(
        `CREATE ROLE "${principal}" LOGIN PASSWORD 'integration-only' NOSUPERUSER NOCREATEDB NOCREATEROLE`
      );
    const owner = new URL(url);
    owner.pathname = '/' + name;
    database = new DataSource({ type: 'postgres', url: owner.toString() });
    await database.initialize();
    await database.query('CREATE TABLE staff_users(worker_id uuid PRIMARY KEY,password_hash text)');
    await database.query(readSchemaSection('auth'));
    provider = await seedLocalAuth(database, secret, role);
    await database.query(readSchemaSection('task-limit'));
    await database.query(`GRANT SELECT ON mad_revoked_sessions,mad_task_limit_policy,mad_task_limit_history,mad_task_limit_ack TO "${role}";
   GRANT UPDATE(requested_limit,version,updated_by,updated_at) ON mad_task_limit_policy TO "${role}";
   GRANT INSERT ON mad_task_limit_history TO "${role}";
   GRANT SELECT ON mad_task_limit_policy,mad_task_limit_history TO "${wkmsRole}";
   GRANT UPDATE(singleton) ON mad_task_limit_policy TO "${wkmsRole}";
   GRANT EXECUTE ON FUNCTION mad_confirm_task_limit(integer,integer) TO "${wkmsRole}";
   CREATE TABLE wkms_effective_task_policy(singleton boolean PRIMARY KEY CHECK(singleton),version integer NOT NULL,task_limit integer NOT NULL);
   CREATE TABLE wkms_tasks(task_id uuid PRIMARY KEY,assigned_worker_id uuid,status text NOT NULL);
   GRANT SELECT,INSERT,UPDATE ON wkms_effective_task_policy,wkms_tasks TO "${wkmsRole}";`);
    const workerUrl = new URL(owner);
    workerUrl.username = wkmsRole;
    workerUrl.password = 'integration-only';
    wkms = new DataSource({ type: 'postgres', url: workerUrl.toString() });
    await wkms.initialize();
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
              INITIAL_MANAGER_USERNAME: '',
              INITIAL_MANAGER_PASSWORD: ''
            })
          ]
        }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: owner.toString(),
          synchronize: false
        }),
        SettingsModule
      ]
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  }, 60000);
  beforeEach(async () => {
    await database.query(`TRUNCATE mad_task_limit_ack,mad_task_limit_policy,mad_task_limit_history,wkms_effective_task_policy,wkms_tasks;
 INSERT INTO mad_task_limit_history(version,task_limit) VALUES(0,3);INSERT INTO mad_task_limit_policy(singleton,requested_limit,version) VALUES(true,3,0)`);
  });
  afterAll(async () => {
    await app?.close();
    if (wkms?.isInitialized) await wkms.destroy();
    if (database?.isInitialized) await database.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      for (const principal of [role, wkmsRole]) await admin.query(`DROP ROLE IF EXISTS "${principal}"`);
      await admin.destroy();
    }
  });
  function get(token: string | null = provider.issue('manager')) {
    const req = request(app.getHttpServer()).get('/mad/settings/task-limit');
    if (token) req.set('Authorization', 'Bearer ' + token);
    return req;
  }
  function patch(body: unknown, token: string | null = provider.issue('manager')) {
    const req = request(app.getHttpServer())
      .patch('/mad/settings/task-limit')
      .send(body as object);
    if (token) req.set('Authorization', 'Bearer ' + token);
    return req;
  }
  it('TC-MAD-045-AC1: default3, pending saves, exact WKMS confirmation and restart persistence', async () => {
    expect((await get().expect(200)).body as unknown).toMatchObject({
      limit: 3,
      version: 0,
      effectiveLimit: null,
      status: 'PENDING'
    });
    await applyWkmsTaskLimit(wkms);
    expect((await get().expect(200)).body as unknown).toMatchObject({
      effectiveLimit: 3,
      effectiveVersion: 0,
      status: 'EFFECTIVE'
    });
    expect((await patch({ limit: 2, version: 0 }).expect(200)).body as unknown).toMatchObject({
      limit: 2,
      version: 1,
      effectiveLimit: 3,
      effectiveVersion: 0,
      status: 'PENDING'
    });
    await expect(wkms.query('SELECT mad_confirm_task_limit(0,3)')).rejects.toThrow();
    await expect(wkms.query('SELECT mad_confirm_task_limit(1,4)')).rejects.toThrow();
    await applyWkmsTaskLimit(wkms);
    const confirmed = (await get().expect(200)).body as { confirmedAt: string };
    expect(confirmed).toMatchObject({
      effectiveLimit: 2,
      effectiveVersion: 1,
      status: 'EFFECTIVE'
    });
    await applyWkmsTaskLimit(wkms);
    expect(((await get().expect(200)).body as { confirmedAt: string }).confirmedAt).toBe(confirmed.confirmedAt);
    await database.query(readSchemaSection('task-limit'));
    expect((await get().expect(200)).body as unknown).toMatchObject({
      limit: 2,
      version: 1,
      effectiveVersion: 1
    });
    expect(await database.query('SELECT task_limit,changed_by FROM mad_task_limit_history WHERE version=1')).toEqual([
      { task_limit: 2, changed_by: provider.ids.get('manager') }
    ]);
  });
  it('TC-MAD-045-AC2: invalid, unknown-query, unauthorized and stale requests do not overwrite policy', async () => {
    for (const body of [
      { limit: 0, version: 0 },
      { limit: 11, version: 0 },
      { limit: 1.5, version: 0 },
      { limit: '3', version: 0 },
      { limit: null, version: 0 },
      { limit: 2 },
      { limit: 2, version: -1 },
      { limit: 2, version: 0, other: true }
    ])
      await patch(body).expect(400);
    for (const [token, status] of [
      [null, 401],
      ['bad', 401],
      [provider.issue('worker'), 403],
      [provider.issue('first-login'), 403]
    ] as const) {
      await get(token).expect(status);
      await patch({ limit: 2, version: 0 }, token).expect(status);
    }
    await request(app.getHttpServer())
      .get('/mad/settings/task-limit?extra=1')
      .set('Authorization', 'Bearer ' + provider.issue('manager'))
      .expect(400);
    await request(app.getHttpServer())
      .patch('/mad/settings/task-limit?extra=1')
      .set('Authorization', 'Bearer ' + provider.issue('manager'))
      .send({ limit: 2, version: 0 })
      .expect(400);
    expect(await database.query('SELECT version,requested_limit FROM mad_task_limit_policy')).toEqual([
      { version: 0, requested_limit: 3 }
    ]);
    const results = await Promise.all([patch({ limit: 1, version: 0 }), patch({ limit: 10, version: 0 })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await database.query('SELECT count(*)::int AS count FROM mad_task_limit_history')).toEqual([{ count: 2 }]);
    const runtime = app.get(DataSource);
    await expect(runtime.query('SELECT mad_confirm_task_limit(1,1)')).rejects.toThrow();
    await expect(runtime.query('DELETE FROM mad_task_limit_ack')).rejects.toThrow();
    await expect(runtime.query("UPDATE wkms_tasks SET status='COMPLETED'")).rejects.toThrow();
  });
  it('TC-MAD-045-AC3: reference owner retains tasks on reduction and serializes concurrent claims', async () => {
    await applyWkmsTaskLimit(wkms);
    const worker = provider.ids.get('worker')!;
    for (const status of ['ASSIGNED', 'IN_PROGRESS', 'ESCALATED'])
      await database.query('INSERT INTO wkms_tasks VALUES($1,$2,$3)', [randomUUID(), worker, status]);
    const next = randomUUID();
    await database.query("INSERT INTO wkms_tasks VALUES($1,NULL,'UNASSIGNED')", [next]);
    await patch({ limit: 2, version: 0 }).expect(200);
    await applyWkmsTaskLimit(wkms);
    await expect(claimWkmsTask(wkms, worker, next)).rejects.toThrow('ACTIVE_TASK_LIMIT');
    expect(
      await database.query('SELECT count(*)::int AS count FROM wkms_tasks WHERE assigned_worker_id=$1', [worker])
    ).toEqual([{ count: 3 }]);
    await database.query('TRUNCATE wkms_tasks');
    await database.query("INSERT INTO wkms_tasks VALUES($1,$2,'ASSIGNED')", [randomUUID(), worker]);
    const tasks = [randomUUID(), randomUUID()];
    for (const id of tasks) await database.query("INSERT INTO wkms_tasks VALUES($1,NULL,'UNASSIGNED')", [id]);
    const results = await Promise.allSettled(
      tasks.map((id, index) => claimWkmsTask(wkms, index === 0 ? worker : worker.toUpperCase(), id))
    );
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') expect(result.value).toEqual({ task_id: tasks[index] });
      else expect(result.reason).toMatchObject({ message: 'ACTIVE_TASK_LIMIT' });
    }
    expect(
      await database.query('SELECT count(*)::int AS count FROM wkms_tasks WHERE assigned_worker_id=$1', [worker])
    ).toEqual([{ count: 2 }]);
  });
  it('returns the claimed task and rejects an already assigned task without changing its owner', async () => {
    await applyWkmsTaskLimit(wkms);
    const worker = provider.ids.get('worker')!;
    const task = randomUUID();
    await database.query("INSERT INTO wkms_tasks VALUES($1,NULL,'UNASSIGNED')", [task]);
    await expect(claimWkmsTask(wkms, worker, task)).resolves.toEqual({
      task_id: task
    });
    await expect(claimWkmsTask(wkms, worker, task)).rejects.toThrow('TASK_UNAVAILABLE');
    expect(await database.query('SELECT assigned_worker_id,status FROM wkms_tasks WHERE task_id=$1', [task])).toEqual([
      { assigned_worker_id: worker, status: 'ASSIGNED' }
    ]);
  });
  it('keeps the previous effective policy if WKMS cannot commit its acknowledgement', async () => {
    await applyWkmsTaskLimit(wkms);
    await patch({ limit: 2, version: 0 }).expect(200);
    await database.query(`REVOKE EXECUTE ON FUNCTION mad_confirm_task_limit(integer,integer) FROM "${wkmsRole}"`);
    try {
      await expect(applyWkmsTaskLimit(wkms)).rejects.toThrow();
      expect((await get().expect(200)).body as unknown).toMatchObject({
        limit: 2,
        version: 1,
        effectiveLimit: 3,
        effectiveVersion: 0,
        status: 'PENDING'
      });
      expect(await database.query('SELECT version,task_limit FROM wkms_effective_task_policy')).toEqual([
        { version: 0, task_limit: 3 }
      ]);
    } finally {
      await database.query(`GRANT EXECUTE ON FUNCTION mad_confirm_task_limit(integer,integer) TO "${wkmsRole}"`);
    }
  });
  it('returns unavailable for missing storage or failed transactional writes rather than inventing a policy', async () => {
    await database.query(`REVOKE INSERT ON mad_task_limit_history FROM "${role}"`);
    try {
      await patch({ limit: 2, version: 0 }).expect(503);
      expect((await get().expect(200)).body as unknown).toMatchObject({
        limit: 3,
        version: 0
      });
    } finally {
      await database.query(`GRANT INSERT ON mad_task_limit_history TO "${role}"`);
    }
    await database.query('DELETE FROM mad_task_limit_policy');
    await get().expect(503);
  });
});
