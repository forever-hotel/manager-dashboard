// TEST-ONLY provider and database. Never imported by the application or container build.
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AuthModule } from '../src/auth/auth.module';
import { HealthController } from '../src/health/health.controller';
import { configureHttp } from '../src/common/http';
import { migrate } from '../src/database/migrate';
import { seedLocalAuth } from './local-auth-fixture';

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.includes('test'))
    throw new Error(
      'TEST_DATABASE_URL must identify a disposable test database',
    );
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const name = 'mad_browser_test_' + suffix;
  const role = 'mad_browser_app_' + suffix;
  const admin = new DataSource({ type: 'postgres', url });
  await admin.initialize();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.query(
    `CREATE ROLE "${role}" LOGIN PASSWORD 'integration-only' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
  );
  const owner = new URL(url);
  owner.pathname = '/' + name;
  const database = new DataSource({ type: 'postgres', url: owner.toString() });
  await database.initialize();
  await migrate(database, role);
  const runtime = new URL(owner);
  runtime.username = role;
  runtime.password = 'integration-only';
  const secret = 'browser-test-only-secret-at-least-32-characters';
  await seedLocalAuth(database, secret, role);
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
        url: runtime.toString(),
        synchronize: false,
      }),
      AuthModule,
    ],
    controllers: [HealthController],
  }).compile();
  const app = module.createNestApplication();
  configureHttp(app);
  await app.listen(4401, '127.0.0.1');
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    await database.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    await admin.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}
void main().catch(() => {
  console.error(
    'Test stack could not start. Check the disposable TEST_DATABASE_URL.',
  );
  process.exitCode = 1;
});
