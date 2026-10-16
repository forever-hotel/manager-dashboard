import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { compare, getRounds } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { configureHttp } from '../src/common/http';
import { CredentialCipher } from '../src/staff/credential-cipher';
import { STAFF_ROLES } from '../src/staff/create-staff.dto';
import { StaffDeliveryWorker } from '../src/staff/staff-delivery.worker';
import type { StaffProfile } from '../src/staff/staff-profiles.service';
import { StaffModule } from '../src/staff/staff.module';

describe('DDP-012 API and disposable PostgreSQL integration', () => {
  let admin: DataSource;
  let database: DataSource;
  let runtime: DataSource;
  let app: INestApplication<App>;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const name = 'ddp_staff_test_' + suffix;
  const role = 'ddp_staff_app_' + suffix;
  const secret = 'staff-test-only-secret-at-least-32-characters';
  const key = Buffer.alloc(32, 9).toString('base64');
  const ids = {
    manager: randomUUID(),
    worker: randomUUID(),
    first: randomUUID(),
  };
  const config = {
    JWT_SECRET: secret,
    JWT_ISSUER: 'mad',
    STAFF_CREDENTIALS_KEY: key,
    STAFF_EMAIL_ENABLED: 'false',
    INITIAL_MANAGER_EMAIL: '',
    INITIAL_MANAGER_USERNAME: '',
    INITIAL_MANAGER_PASSWORD: '',
  };
  const profile = {
    name: 'Test Staff',
    vocation: 'Reception',
    email: 'staff@example.com',
    age: 25,
    phone: '+94771234567',
    nic: '200012345678',
    role: 'RECEPTIONIST',
  };
  const cipher = new CredentialCipher(new ConfigService(config));
  function token(user: keyof typeof ids = 'manager') {
    return new JwtService({ secret }).sign(
      {
        sub: ids[user],
        role: user === 'worker' ? 'WORKER' : 'MANAGER',
        ver: 0,
        jti: randomUUID(),
      },
      { issuer: 'mad', audience: 'mad', expiresIn: '8h' },
    );
  }
  function post(body: unknown = profile, session = token()) {
    return request(app.getHttpServer())
      .post('/mad/staff')
      .set('Authorization', 'Bearer ' + session)
      .send(body as object);
  }
  async function count() {
    const rows = await database.query<{ count: string }[]>(
      "SELECT count(*) FROM staff_users WHERE email LIKE '%@example.com'",
    );
    return Number(rows[0].count);
  }
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
    for (const file of [
      'ci-schema.sql',
      'neon-mad-auth.sql',
      'neon-mad-staff.sql',
    ])
      await database.query(
        readFileSync(resolve(__dirname, '../../deploy', file), 'utf8'),
      );
    await database.query(`GRANT SELECT, INSERT, UPDATE ON staff_users TO "${role}";
      GRANT SELECT ON mad_revoked_sessions TO "${role}";
      GRANT SELECT, INSERT, UPDATE ON mad_staff_deliveries TO "${role}"`);
    for (const user of ['manager', 'worker', 'first'] as const)
      await database.query(
        `INSERT INTO staff_users(worker_id,full_name,vocation,email,username,password_hash,role,password_change_required)
        VALUES ($1,'Fixture','Fixture',$2,$3,'unused-in-session-fixture',$4,$5)`,
        [
          ids[user],
          user + '@fixture.invalid',
          user,
          user === 'worker' ? 'WORKER' : 'MANAGER',
          user === 'first',
        ],
      );
    owner.username = role;
    owner.password = 'integration-only';
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => config],
        }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: owner.toString(),
          synchronize: false,
        }),
        StaffModule,
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    runtime = app.get(DataSource);
  }, 60000);
  beforeEach(async () => {
    await database.query('TRUNCATE mad_staff_deliveries');
    await database.query(
      "DELETE FROM staff_users WHERE email LIKE '%@example.com'",
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
  it.each(STAFF_ROLES)(
    'TC-MAD-012-AC1: persists %s with encrypted delivery and cost-12 credentials',
    async (staffRole) => {
      const response = await post({ ...profile, role: staffRole }).expect(201);
      const body = response.body as {
        staffId: string;
        deliveryId: string;
        deliveryStatus: string;
      };
      expect(Object.keys(body).sort()).toEqual([
        'deliveryId',
        'deliveryStatus',
        'staffId',
      ]);
      expect(body.deliveryStatus).toBe('pending');
      const [account] = await database.query<
        {
          password_hash: string;
          password_change_required: boolean;
          username: string;
          role: string;
        }[]
      >('SELECT * FROM staff_users WHERE worker_id=$1', [body.staffId]);
      const [delivery] = await database.query<
        { encrypted_credentials: string }[]
      >('SELECT * FROM mad_staff_deliveries WHERE delivery_id=$1', [
        body.deliveryId,
      ]);
      const credentials = cipher.decrypt(
        body.deliveryId,
        delivery.encrypted_credentials,
      );
      expect(credentials.email).toBe(profile.email);
      expect(credentials.username).toBe(account.username);
      expect(account.role).toBe(staffRole);
      expect(account.password_change_required).toBe(true);
      expect(getRounds(account.password_hash)).toBe(12);
      expect(await compare(credentials.password, account.password_hash)).toBe(
        true,
      );
      expect(JSON.stringify(body)).not.toContain(credentials.password);
    },
  );
  it('TC-MAD-012-AC2: duplicate email returns 409 without another delivery', async () => {
    await post().expect(201);
    const response = await post({
      ...profile,
      email: ' STAFF@EXAMPLE.COM ',
    }).expect(409);
    expect(response.body).toMatchObject({ code: 'CONFLICT' });
    expect(await count()).toBe(1);
    const rows = await database.query<unknown[]>(
      'SELECT delivery_id FROM mad_staff_deliveries',
    );
    expect(rows).toHaveLength(1);
  });
  it.each([
    { role: 'MANAGER' },
    { role: 'UNKNOWN' },
    { email: 'bad' },
    { age: -1 },
    { age: '25' },
    { nic: 'bad' },
    { name: '' },
    { vocation: '' },
    { phone: '' },
    { unexpected: true },
  ])('TC-MAD-012-AC2: invalid input %j creates nothing', async (change) => {
    const response = await post({ ...profile, ...change }).expect(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await count()).toBe(0);
  });
  it('rejects missing and invalid sessions, workers and first-login managers before writing', async () => {
    await request(app.getHttpServer())
      .post('/mad/staff')
      .send(profile)
      .expect(401);
    await post(profile, 'invalid').expect(401);
    await post(profile, token('worker')).expect(403);
    await post(profile, token('first')).expect(403);
    expect(await count()).toBe(0);
  });
  it.each(['name', 'vocation', 'email', 'age', 'phone', 'nic', 'role'])(
    'TC-MAD-012-AC2: missing %s is rejected without a write',
    async (field) => {
      const body: Record<string, unknown> = { ...profile };
      delete body[field];
      await post(body).expect(400);
      expect(await count()).toBe(0);
    },
  );
  it('TC-MAD-012-AC3: concurrent requests enforce email and username uniqueness', async () => {
    const duplicate = await Promise.all([post(), post()]);
    expect(duplicate.map((r) => r.status).sort()).toEqual([201, 409]);
    const results = await Promise.all([
      post({ ...profile, email: 'two@example.com' }),
      post({ ...profile, email: 'three@example.com' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const rows = await database.query<{ username: string }[]>(
      "SELECT username FROM staff_users WHERE email LIKE '%@example.com'",
    );
    expect(new Set(rows.map((r) => r.username)).size).toBe(3);
  });
  it('rolls back account creation if the delivery insert fails', async () => {
    await database.query(
      `REVOKE INSERT ON mad_staff_deliveries FROM "${role}"`,
    );
    try {
      const response = await post().expect(503);
      expect(response.body).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable. Please retry.',
      });
      expect(await count()).toBe(0);
    } finally {
      await database.query(`GRANT INSERT ON mad_staff_deliveries TO "${role}"`);
    }
  });
  it('TC-MAD-012-AC3: retries provider failure using the same account and credentials', async () => {
    await post().expect(201);
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValue(undefined);
    const worker = new StaffDeliveryWorker(
      runtime,
      new ConfigService({ ...config, STAFF_EMAIL_ENABLED: 'true' }),
      cipher,
      { send },
    );
    await worker.processOnce();
    const [failed] = await database.query<
      { status: string; encrypted_credentials: string }[]
    >('SELECT * FROM mad_staff_deliveries');
    expect(failed.status).toBe('failed');
    expect(failed.encrypted_credentials).toBeTruthy();
    await database.query(
      'UPDATE mad_staff_deliveries SET next_attempt_at=now()',
    );
    await Promise.all([worker.processOnce(), worker.processOnce()]);
    const [sent] = await database.query<
      {
        status: string;
        encrypted_credentials: string | null;
        attempts: number;
      }[]
    >('SELECT * FROM mad_staff_deliveries');
    expect(sent).toMatchObject({
      status: 'sent',
      encrypted_credentials: null,
      attempts: 2,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    expect(await count()).toBe(1);
  });
  function reset(id: string, session = token()) {
    return request(app.getHttpServer())
      .post('/mad/staff/' + id + '/reset-password')
      .set('Authorization', 'Bearer ' + session);
  }
  async function snapshot(id: string) {
    const [row] = await database.query<
      {
        password_hash: string;
        session_version: number;
        password_change_required: boolean;
        failed_attempts: number;
        locked_until: Date | null;
      }[]
    >(
      'SELECT password_hash,session_version,password_change_required,failed_attempts,locked_until FROM staff_users WHERE worker_id=$1',
      [id],
    );
    return row;
  }
  it.each(STAFF_ROLES)(
    'TC-MAD-013-AC1/AC3: resets %s and queues only the new credential version',
    async (staffRole) => {
      const created = await post({ ...profile, role: staffRole }).expect(201);
      const { staffId, deliveryId } = created.body as {
        staffId: string;
        deliveryId: string;
      };
      const [original] = await database.query<
        { encrypted_credentials: string }[]
      >(
        'SELECT encrypted_credentials FROM mad_staff_deliveries WHERE worker_id=$1',
        [staffId],
      );
      const oldToken = new JwtService({ secret }).sign(
        { sub: staffId, role: staffRole, ver: 0, jti: randomUUID() },
        { issuer: 'mad', audience: 'mad', expiresIn: '8h' },
      );
      await post(profile, oldToken).expect(403);
      const oldPassword = cipher.decrypt(
        deliveryId,
        original.encrypted_credentials,
      ).password;
      await database.query(
        "UPDATE staff_users SET password_change_required=false,failed_attempts=5,locked_until=now()+interval '15 minutes' WHERE worker_id=$1",
        [staffId],
      );
      const response = await reset(staffId).expect(200);
      await post(profile, oldToken).expect(401);
      const body = response.body as {
        staffId: string;
        deliveryId: string;
        deliveryStatus: string;
      };
      expect(body).toEqual({
        staffId,
        deliveryId: body.deliveryId,
        deliveryStatus: 'pending',
      });
      expect(body.deliveryId).not.toBe(deliveryId);
      const account = await snapshot(staffId);
      expect(account).toMatchObject({
        session_version: 1,
        password_change_required: true,
        failed_attempts: 0,
        locked_until: null,
      });
      expect(await compare(oldPassword, account.password_hash)).toBe(false);
      const [delivery] = await database.query<
        { encrypted_credentials: string; credential_version: number }[]
      >('SELECT * FROM mad_staff_deliveries WHERE worker_id=$1', [staffId]);
      expect(delivery.credential_version).toBe(account.session_version);
      const credentials = cipher.decrypt(
        body.deliveryId,
        delivery.encrypted_credentials,
      );
      expect(await compare(credentials.password, account.password_hash)).toBe(
        true,
      );
      expect(getRounds(account.password_hash)).toBe(12);
      const send = jest
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue(undefined);
      const worker = new StaffDeliveryWorker(
        runtime,
        new ConfigService({ ...config, STAFF_EMAIL_ENABLED: 'true' }),
        cipher,
        { send },
      );
      await worker.processOnce();
      await database.query(
        'UPDATE mad_staff_deliveries SET next_attempt_at=now() WHERE worker_id=$1',
        [staffId],
      );
      await worker.processOnce();
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
      expect(await snapshot(staffId)).toEqual(account);
    },
  );
  it('TC-MAD-013-AC2: rejects missing, malformed and unauthorized requests without writes', async () => {
    const created = await post().expect(201);
    const { staffId } = created.body as { staffId: string };
    const before = await snapshot(staffId);
    await request(app.getHttpServer())
      .post('/mad/staff/' + staffId + '/reset-password')
      .expect(401);
    await reset(staffId, 'invalid').expect(401);
    await reset(staffId, token('worker')).expect(403);
    await reset(staffId, token('first')).expect(403);
    expect((await reset(randomUUID()).expect(404)).body).toMatchObject({
      code: 'NOT_FOUND',
    });
    await reset('invalid-id').expect(400);
    await reset(ids.manager).expect(404);
    expect(await snapshot(staffId)).toEqual(before);
    await database.query(
      'UPDATE staff_users SET is_active=false WHERE worker_id=$1',
      [staffId],
    );
    await reset(staffId).expect(409);
    expect(await snapshot(staffId)).toEqual(before);
  });
  it('TC-DDP-013-ATOMIC: rolls back password and version if queue update fails', async () => {
    const created = await post().expect(201);
    const { staffId } = created.body as { staffId: string };
    const before = await snapshot(staffId);
    await database.query(
      `REVOKE UPDATE ON mad_staff_deliveries FROM "${role}"`,
    );
    try {
      await reset(staffId).expect(503);
      expect(await snapshot(staffId)).toEqual(before);
    } finally {
      await database.query(`GRANT UPDATE ON mad_staff_deliveries TO "${role}"`);
    }
  });
  it('TC-DDP-013-CONCURRENT: serializes resets and retains the latest matching delivery', async () => {
    const created = await post().expect(201);
    const { staffId } = created.body as { staffId: string };
    const responses = await Promise.all([reset(staffId), reset(staffId)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const account = await snapshot(staffId);
    expect(account.session_version).toBe(2);
    const rows = await database.query<
      {
        delivery_id: string;
        encrypted_credentials: string;
        credential_version: number;
      }[]
    >('SELECT * FROM mad_staff_deliveries WHERE worker_id=$1', [staffId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].credential_version).toBe(2);
    expect(
      await compare(
        cipher.decrypt(rows[0].delivery_id, rows[0].encrypted_credentials)
          .password,
        account.password_hash,
      ),
    ).toBe(true);
  });
  function readProfile(id: string, session = token()) {
    return request(app.getHttpServer())
      .get('/mad/staff/' + id)
      .set('Authorization', 'Bearer ' + session);
  }
  function edit(id: string, body: unknown, session = token()) {
    return request(app.getHttpServer())
      .patch('/mad/staff/' + id)
      .set('Authorization', 'Bearer ' + session)
      .send(body as object);
  }
  it('TC-MAD-014-AC1: returns a safe profile and preserves pending credentials across profile/role edits', async () => {
    const created = await post().expect(201);
    const { staffId, deliveryId } = created.body as {
      staffId: string;
      deliveryId: string;
    };
    const original = (await readProfile(staffId).expect(200))
      .body as StaffProfile;
    expect(original.version).toBe(0);
    expect(Object.keys(original).sort()).toEqual(
      [
        'age',
        'email',
        'isActive',
        'name',
        'nic',
        'passwordChangeRequired',
        'phone',
        'role',
        'staffId',
        'username',
        'version',
        'vocation',
      ].sort(),
    );
    const before = await snapshot(staffId);
    const [oldDelivery] = await database.query<
      { encrypted_credentials: string }[]
    >(
      'SELECT encrypted_credentials FROM mad_staff_deliveries WHERE worker_id=$1',
      [staffId],
    );
    const oldCredentials = cipher.decrypt(
      deliveryId,
      oldDelivery.encrypted_credentials,
    );
    const changed = (
      await edit(staffId, {
        version: original.version,
        name: ' Updated Name ',
        email: ' UPDATED@EXAMPLE.COM ',
        role: 'KITCHEN_MANAGER',
        age: 30,
        vocation: 'Kitchen',
        phone: '+94770000000',
        nic: '199912345678',
      }).expect(200)
    ).body as StaffProfile;
    expect(Array.isArray(changed)).toBe(false);
    expect(Object.keys(changed).sort()).toEqual(Object.keys(original).sort());
    expect((await readProfile(staffId).expect(200)).body).toEqual(changed);
    expect(changed).toMatchObject({
      name: 'Updated Name',
      email: 'updated@example.com',
      role: 'KITCHEN_MANAGER',
      age: 30,
      vocation: 'Kitchen',
      phone: '+94770000000',
      nic: '199912345678',
      version: 1,
      staffId,
      username: original.username,
    });
    expect((await snapshot(staffId)).password_hash).toBe(before.password_hash);
    const [pending] = await database.query<
      {
        delivery_id: string;
        encrypted_credentials: string;
        credential_version: number;
      }[]
    >('SELECT * FROM mad_staff_deliveries WHERE worker_id=$1', [staffId]);
    expect(pending.delivery_id).not.toBe(deliveryId);
    expect(pending.credential_version).toBe(1);
    expect(
      cipher.decrypt(pending.delivery_id, pending.encrypted_credentials),
    ).toEqual({
      ...oldCredentials,
      email: 'updated@example.com',
      role: 'KITCHEN_MANAGER',
    });
    // A worker already holding the old lease cannot finish the new delivery.
    await database.query(
      "UPDATE mad_staff_deliveries SET status='sent',encrypted_credentials=NULL WHERE delivery_id=$1",
      [deliveryId],
    );
    const send = jest.fn().mockResolvedValue(undefined);
    const worker = new StaffDeliveryWorker(
      runtime,
      new ConfigService({ ...config, STAFF_EMAIL_ENABLED: 'true' }),
      cipher,
      { send },
    );
    await worker.processOnce();
    expect(send).toHaveBeenCalledWith({
      ...oldCredentials,
      email: 'updated@example.com',
      role: 'KITCHEN_MANAGER',
    });
  });
  it('TC-MAD-014-AC2: role changes invalidate old tokens and deactivation cancels credentials without deletion', async () => {
    const { staffId } = (await post().expect(201)).body as { staffId: string };
    const staffToken = (version: number) =>
      new JwtService({ secret }).sign(
        { sub: staffId, role: 'RECEPTIONIST', ver: version, jti: randomUUID() },
        { issuer: 'mad', audience: 'mad', expiresIn: '8h' },
      );
    await readProfile(staffId, staffToken(0)).expect(403);
    await edit(staffId, { version: 0, role: 'WORKER' }).expect(200);
    await readProfile(staffId, staffToken(0)).expect(401);
    await edit(staffId, { version: 1, isActive: false }).expect(200);
    await readProfile(staffId, staffToken(2)).expect(401);
    expect((await readProfile(staffId).expect(200)).body).toMatchObject({
      isActive: false,
      version: 2,
    });
    const [delivery] = await database.query<
      { status: string; encrypted_credentials: string | null }[]
    >(
      'SELECT status,encrypted_credentials FROM mad_staff_deliveries WHERE worker_id=$1',
      [staffId],
    );
    expect(delivery).toEqual({
      status: 'cancelled',
      encrypted_credentials: null,
    });
    expect(await count()).toBe(1);
  });
  it('TC-MAD-014-AC3: duplicate emails and stale/concurrent edits do not overwrite another edit', async () => {
    const { staffId } = (await post().expect(201)).body as { staffId: string };
    await post({ ...profile, email: 'other@example.com' }).expect(201);
    await edit(staffId, { version: 0, email: ' OTHER@EXAMPLE.COM ' }).expect(
      409,
    );
    expect((await readProfile(staffId)).body).toMatchObject({
      email: profile.email,
      version: 0,
    });
    const responses = await Promise.all([
      edit(staffId, { version: 0, name: 'First Edit' }),
      edit(staffId, { version: 0, name: 'Second Edit' }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const saved = responses.find((r) => r.status === 200)?.body as StaffProfile;
    expect((await readProfile(staffId)).body).toEqual(saved);
    await reset(staffId).expect(200);
    await edit(staffId, { version: 1, name: 'Stale After Reset' }).expect(409);
  });
  it('TC-DDP-014-NEGATIVE: rejects bad input, forbidden targets and unauthorized reads/edits without writes', async () => {
    const { staffId } = (await post().expect(201)).body as { staffId: string };
    const before = (await readProfile(staffId)).body as StaffProfile;
    for (const body of [
      {},
      { version: 0 },
      { version: -1, name: 'Test' },
      { version: '0', name: 'Test' },
      { version: 0, role: 'MANAGER' },
      { version: 0, name: null },
      { version: 0, email: 'bad' },
      { version: 0, isActive: true },
      { version: 0, password_hash: 'changed' },
      { version: 0, age: 0 },
      { version: 0, username: 'changed' },
    ])
      await edit(staffId, body).expect(400);
    await edit(randomUUID(), { version: 0, name: 'Test' }).expect(404);
    await edit(ids.manager, { version: 0, isActive: false }).expect(404);
    await readProfile(ids.manager).expect(404);
    await readProfile(randomUUID()).expect(404);
    await readProfile('bad').expect(400);
    await edit('bad', { version: 0, name: 'Test' }).expect(400);
    for (const method of ['get', 'patch'] as const) {
      await request(app.getHttpServer())
        [method]('/mad/staff/' + staffId)
        .send({ version: 0, name: 'Test' })
        .expect(401);
    }
    for (const [session, status] of [
      ['bad', 401],
      [token('worker'), 403],
      [token('first'), 403],
    ] as const) {
      await readProfile(staffId, session).expect(status);
      await edit(staffId, { version: 0, name: 'Test' }, session).expect(status);
    }
    expect((await readProfile(staffId)).body).toEqual(before);
  });
  it('TC-DDP-014-ATOMIC: queue failures roll back profile, permissions and version together', async () => {
    const { staffId } = (await post().expect(201)).body as { staffId: string };
    const before = (await readProfile(staffId)).body as StaffProfile;
    await database.query(
      `REVOKE UPDATE ON mad_staff_deliveries FROM "${role}"`,
    );
    try {
      await edit(staffId, { version: 0, isActive: false }).expect(503);
      expect((await readProfile(staffId)).body).toEqual(before);
    } finally {
      await database.query(`GRANT UPDATE ON mad_staff_deliveries TO "${role}"`);
    }
  });
});
