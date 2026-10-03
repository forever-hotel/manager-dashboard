import { InitialManagerService } from '../src/auth/initial-manager.service';
import { Test } from '@nestjs/testing';
import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthModule } from '../src/auth/auth.module';
import { HealthController } from '../src/health/health.controller';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { configureHttp } from '../src/common/http';
import { migrate } from '../src/database/migrate';
import { seedLocalAuth } from './local-auth-fixture';

// Exercise the exported foundation guard without depending on later feature APIs.
@Controller('protected')
@UseGuards(JwtAuthGuard)
class ProtectedFixtureController {
  @Get()
  get() {
    return { status: 'ok' };
  }
}

describe('DDP-001–008 disposable PostgreSQL/API acceptance', () => {
  let admin: DataSource;
  let database: DataSource;
  let runtime: DataSource;
  let app: INestApplication<App>;
  let provider: Awaited<ReturnType<typeof seedLocalAuth>>;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const name = 'mad_test_' + suffix;
  const role = 'mad_test_app_' + suffix;
  const secret = 'integration-test-only-secret-at-least-32-characters';
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.includes('test'))
      throw new Error(
        'TEST_DATABASE_URL must point to a disposable test database',
      );
    admin = new DataSource({ type: 'postgres', url });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${name}"`);
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD 'integration-only' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
    const ownerUrl = new URL(url);
    ownerUrl.pathname = '/' + name;
    database = new DataSource({ type: 'postgres', url: ownerUrl.toString() });
    await database.initialize();
    // Legacy schema represents populated installations; the migration must adopt it without data loss.
    await database.query(
      readFileSync('test/fixtures/legacy-foundation.sql', 'utf8'),
    );
    await database.query(
      "INSERT INTO mad_promotion_codes(code_string,discount_type,discount_value,valid_from,valid_until) VALUES ('KEEP-ME','FIXED_AMOUNT',100,now(),now()+interval '1 day')",
    );
    await Promise.all([migrate(database, role), migrate(database, role)]);
    const runtimeUrl = new URL(ownerUrl);
    runtimeUrl.username = role;
    runtimeUrl.password = 'integration-only';
    runtime = new DataSource({ type: 'postgres', url: runtimeUrl.toString() });
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
          url: runtimeUrl.toString(),
          autoLoadEntities: true,
          synchronize: false,
        }),
        AuthModule,
      ],
      controllers: [HealthController, ProtectedFixtureController],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  }, 60000);
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
  const http = () => request(app.getHttpServer());
  it('preserves existing data and records each version once despite concurrent runners', async () => {
    const rows = await database.query<{ code_string: string }[]>(
      "SELECT code_string FROM mad_promotion_codes WHERE code_string='KEEP-ME'",
    );
    expect(rows).toHaveLength(1);
    expect(
      await database.query('SELECT version FROM mad_migrations'),
    ).toHaveLength(2);
    await migrate(database, role);
    expect(
      await database.query(
        "SELECT * FROM mad_promotion_codes WHERE code_string='KEEP-ME'",
      ),
    ).toHaveLength(1);
  });
  it('permits reporting reads and MAD writes but denies shared writes and schema changes', async () => {
    await expect(runtime.query('SELECT * FROM bookings')).resolves.toEqual([]);
    await expect(runtime.query('DELETE FROM bookings')).rejects.toMatchObject({
      driverError: { code: '42501' },
    });
    await expect(
      runtime.query('SELECT password_hash FROM staff_users'),
    ).resolves.toHaveLength(3);
    await expect(
      runtime.query("INSERT INTO mad_manager_accounts(username,password_hash) VALUES ('unauthorized','invalid')"),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });
    await expect(
      runtime.query('UPDATE staff_users SET is_active=false'),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });
    await expect(
      runtime.query('CREATE TABLE unauthorized(id integer)'),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });
    await expect(
      runtime.query(
        "INSERT INTO mad_revoked_sessions VALUES (repeat('a',64),now())",
      ),
    ).resolves.toBeDefined();
    await expect(
      runtime.query('UPDATE mad_promotion_codes SET current_redemptions=-1'),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
  });
  it('exposes independent liveness and database readiness', async () => {
    await http().get('/health/live').expect(200);
    await http().get('/health/ready').expect(200);
    await http().get('/mad/health/ready').expect(200);
    await database.query(
      `REVOKE SELECT ON mad_revoked_sessions FROM "${role}"`,
    );
    try {
      const response = await http().get('/health/ready').expect(503);
      expect(response.body).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable. Please retry.',
      });
      await http().get('/health/live').expect(200);
    } finally {
      await database.query(`GRANT SELECT ON mad_revoked_sessions TO "${role}"`);
    }
  });
  it('rejects invalid login input with a stable validation envelope', async () => {
    const result = await http()
      .post('/auth/login')
      .send({ username: '', password: '', extra: 'secret' })
      .expect(400);
    expect(result.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(JSON.stringify(result.body)).not.toContain('secret');
    await http()
      .post('/auth/login')
      .send({ username: 'manager', password: 'wrong' })
      .expect(401);
  });
  it('allows manager access and denies missing sessions and workers', async () => {
    const manager = provider.issue('manager');
    await http()
      .get('/protected')
      .set('Authorization', 'Bearer ' + manager)
      .expect(200);
    await http().get('/protected').expect(401);
    await http()
      .get('/protected')
      .set('Authorization', 'Bearer ' + provider.issue('worker'))
      .expect(403);
  });
  it('denies sessions immediately after local deactivation', async () => {
    const token = provider.issue('manager');
    await http()
      .get('/auth/session')
      .set('Authorization', 'Bearer ' + token)
      .expect(200);
    await database.query('UPDATE staff_users SET is_active=false WHERE username=$1', ['manager']);
    await http()
      .get('/protected')
      .set('Authorization', 'Bearer ' + token)
      .expect(401);
  });
  it('persists local logout revocation without an external service', async () => {
    const token = provider.issue('manager');
    await database.query('UPDATE staff_users SET is_active=true WHERE username=$1', ['manager']);
    await http()
      .post('/auth/logout')
      .set('Authorization', 'Bearer ' + token)
      .expect(200);
    await http()
      .get('/auth/session')
      .set('Authorization', 'Bearer ' + token)
      .expect(401);
  });
  it('requires confirmed password change before protected access', async () => {
    const login = await http()
      .post('/auth/login')
      .send({ username: 'first-login', password: 'contract-password' })
      .expect(200);
    const token = (login.body as { accessToken: string }).accessToken;
    const otherSession = provider.issue('first-login');
    const blocked = await http()
      .get('/protected')
      .set('Authorization', 'Bearer ' + token)
      .expect(403);
    expect(blocked.body).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    const changed = await http()
      .post('/auth/change-password')
      .set('Authorization', 'Bearer ' + token)
      .send({
        currentPassword: 'contract-password',
        newPassword: 'new-contract-password',
      })
      .expect(200);
    await http()
      .get('/protected')
      .set(
        'Authorization',
        'Bearer ' + (changed.body as { accessToken: string }).accessToken,
      )
      .expect(200);
    await http()
      .get('/auth/session')
      .set('Authorization', 'Bearer ' + token)
      .expect(401);
    await http().get('/auth/session')
      .set('Authorization', 'Bearer ' + otherSession).expect(401);
  });
  it('persists account lockout and permits login again after the lock expires', async () => {
    await database.query("UPDATE staff_users SET failed_attempts=0, locked_until=NULL WHERE username='manager'");
    for (let attempt = 0; attempt < 5; attempt++)
      await http().post('/auth/login').send({ username: 'manager', password: 'wrong' }).expect(401);
    await http().post('/auth/login').send({ username: 'manager', password: 'contract-password' }).expect(401);
    await database.query("UPDATE staff_users SET locked_until=now()-interval '1 second' WHERE username='manager'");
    await http().post('/auth/login').send({ username: 'manager', password: 'contract-password' }).expect(200);
  });
  it('creates a fresh schema and supports clean migration reruns', async () => {
    const fresh = 'mad_test_fresh_' + suffix;
    await admin.query(`CREATE DATABASE "${fresh}"`);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = '/' + fresh;
    const source = new DataSource({ type: 'postgres', url: url.toString() });
    try {
      await source.initialize();
      await migrate(source, role);
      await migrate(source, role);
      expect(await source.query('SELECT * FROM mad_migrations')).toHaveLength(
        2,
      );
      expect(await source.query('SELECT * FROM mad_promotion_codes')).toEqual(
        [],
      );
    } finally {
      if (source.isInitialized) await source.destroy();
      await admin.query(`DROP DATABASE "${fresh}" WITH (FORCE)`);
    }
  });
  it('bootstraps once and preserves the changed password across concurrent restarts', async () => {
    const settings = {
      INITIAL_MANAGER_EMAIL: 'bootstrap@example.com',
      INITIAL_MANAGER_USERNAME: 'bootstrap-manager',
      INITIAL_MANAGER_PASSWORD: 'bootstrap-initial-password',
    };
    const start = () => new InitialManagerService(new ConfigService(settings), database).onApplicationBootstrap();
    await Promise.all([start(), start()]);
    const accounts = await database.query("SELECT * FROM staff_users WHERE email='bootstrap@example.com'");
    expect(accounts).toHaveLength(1);
    expect(accounts[0].password_change_required).toBe(true);
    const login = await http().post('/auth/login').send({ username: settings.INITIAL_MANAGER_USERNAME, password: settings.INITIAL_MANAGER_PASSWORD }).expect(200);
    expect(login.body.passwordChangeRequired).toBe(true);
    await http().get('/protected').set('Authorization', 'Bearer ' + login.body.accessToken).expect(403);
    const changed = await http().post('/auth/change-password')
      .set('Authorization', 'Bearer ' + login.body.accessToken)
      .send({ currentPassword: settings.INITIAL_MANAGER_PASSWORD, newPassword: 'bootstrap-changed-password' }).expect(200);
    expect(changed.body.passwordChangeRequired).toBe(false);
    settings.INITIAL_MANAGER_PASSWORD = 'different-environment-password';
    await Promise.all([start(), start()]);
    const saved = await database.query("SELECT * FROM staff_users WHERE email='bootstrap@example.com'");
    expect(saved).toHaveLength(1);
    expect(saved[0].password_change_required).toBe(false);
    expect(saved[0].session_version).toBe(1);
    await http().post('/auth/login').send({ username: settings.INITIAL_MANAGER_USERNAME, password: 'bootstrap-initial-password' }).expect(401);
    await http().post('/auth/login').send({ username: settings.INITIAL_MANAGER_USERNAME, password: settings.INITIAL_MANAGER_PASSWORD }).expect(401);
    const returning = await http().post('/auth/login').send({ username: settings.INITIAL_MANAGER_USERNAME, password: 'bootstrap-changed-password' }).expect(200);
    expect(returning.body.passwordChangeRequired).toBe(false);
    await http().get('/protected').set('Authorization', 'Bearer ' + returning.body.accessToken).expect(200);
  });

});
