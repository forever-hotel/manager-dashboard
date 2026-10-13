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
import { SendGridService } from '../src/staff/sendgrid.service';
import { StaffDeliveryWorker } from '../src/staff/staff-delivery.worker';
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
    await database.query(`GRANT SELECT, INSERT ON staff_users TO "${role}";
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
      { send } as unknown as SendGridService,
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
});
