import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
import { DataSource } from 'typeorm';
import { configureHttp } from '../src/common/http';
import { NotificationsModule } from '../src/notifications/notifications.module';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NotificationsWorker } from '../src/notifications/notifications.worker';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { seedLocalAuth } from './local-auth-fixture';
type Snapshot = Awaited<ReturnType<NotificationsService['snapshot']>>;
describe('DDP-043 notifications with disposable PostgreSQL and authenticated sockets', () => {
  let admin: DataSource,
    database: DataSource,
    app: INestApplication<App>,
    provider: Awaited<ReturnType<typeof seedLocalAuth>>;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12),
    name = 'ddp_notifications_test_' + suffix,
    role = 'ddp_notifications_app_' + suffix;
  const complaint = randomUUID(),
    stock = randomUUID(),
    secret = 'notifications-test-only-secret-at-least-32-characters';
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.includes('test'))
      throw new Error('Use a disposable TEST_DATABASE_URL containing test');
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
    await database.query(readFileSync('../deploy/neon-mad-auth.sql', 'utf8'));
    await database.query(`CREATE TABLE foss_complaints(complaint_id uuid PRIMARY KEY,category text,status text,submitted_at timestamptz,description text,resolution_notes text);
  CREATE TABLE mad_complaint_state(complaint_id uuid PRIMARY KEY,version integer);
  CREATE TABLE kms_menu_items(menu_item_id uuid PRIMARY KEY,name text,stock_status text,updated_at timestamptz);
  GRANT SELECT ON mad_revoked_sessions,mad_complaint_state TO "${role}";
  GRANT SELECT(complaint_id,category,status,submitted_at) ON foss_complaints TO "${role}";
  GRANT SELECT(menu_item_id,name,stock_status,updated_at) ON kms_menu_items TO "${role}";`);
    await database.query(
      readFileSync('../deploy/neon-mad-notifications.sql', 'utf8'),
    );
    await database.query(
      `GRANT SELECT,INSERT,UPDATE ON mad_notification_reads TO "${role}"`,
    );
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
              FRONTEND_URL: 'http://localhost:3000',
              MAD_REALTIME_ENABLED: 'false',
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
        NotificationsModule,
      ],
    })
      .overrideProvider(NotificationsWorker)
      .useFactory({
        factory: (service: NotificationsService, gateway: RealtimeGateway) => {
          const worker = new NotificationsWorker(service, gateway);
          worker.onApplicationBootstrap = () => {};
          return worker;
        },
        inject: [NotificationsService, RealtimeGateway],
      })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
  }, 60000);
  beforeEach(async () => {
    await database.query(
      'TRUNCATE mad_notification_reads,foss_complaints,mad_complaint_state,kms_menu_items',
    );
    await database.query(
      "INSERT INTO foss_complaints VALUES($1,'Room','SUBMITTED','2026-10-21T00:00:00Z','guest description','PRIVATE NOTE')",
      [complaint],
    );
    await database.query(
      "INSERT INTO kms_menu_items VALUES($1,'Rice','LOW_STOCK','2026-10-21T00:00:00.123456Z')",
      [stock],
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
  function get(query = '', token: string | null = provider.issue('manager')) {
    const req = request(app.getHttpServer()).get('/mad/notifications?' + query);
    if (token) req.set('Authorization', 'Bearer ' + token);
    return req;
  }
  function read(
    revision = 'SUBMITTED:0',
    token: string | null = provider.issue('manager'),
  ) {
    const req = request(app.getHttpServer())
      .patch('/mad/notifications/COMPLAINT/' + complaint + '/read')
      .send({ revision });
    if (token) req.set('Authorization', 'Bearer ' + token);
    return req;
  }
  async function socket() {
    const response = await request(app.getHttpServer())
      .post('/mad/realtime/ticket')
      .set('Authorization', 'Bearer ' + provider.issue('manager'))
      .expect(201);
    const client = io(await app.getUrl(), {
      path: '/mad/socket.io',
      transports: ['websocket'],
      auth: { ticket: (response.body as { ticket: string }).ticket },
      extraHeaders: { Origin: 'http://localhost:3000' },
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    return client;
  }
  it('TC-MAD-043-AC1: returns authoritative counts, safe detail links and stable paginated identities', async () => {
    const response = await get().expect(200);
    const body = response.body as Snapshot;
    expect(body).toMatchObject({
      total: 2,
      unread: 2,
      counts: { complaints: 1, stock: 1 },
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE NOTE|guest description/);
    expect(body.items.find((i) => i.type === 'COMPLAINT')?.href).toBe(
      '/complaints?complaintId=' + complaint,
    );
    const first = (await get('pageSize=1').expect(200)).body as Snapshot;
    const second = (await get('pageSize=1&page=2').expect(200))
      .body as Snapshot;
    expect(
      new Set([...first.items, ...second.items].map((i) => i.id)).size,
    ).toBe(2);
    expect(second.total).toBe(2);
  });
  it('TC-MAD-043-AC2: read receipts persist per manager without resolving issues; recovery removes active alerts', async () => {
    await read().expect(200);
    await read().expect(200);
    expect(
      (
        await new NotificationsService(database).snapshot(
          provider.ids.get('manager')!,
          { page: 1, pageSize: 20 },
        )
      ).unread,
    ).toBe(1);
    expect(((await get().expect(200)).body as Snapshot).unread).toBe(1);
    expect(((await get().expect(200)).body as Snapshot).total).toBe(2);
    const other = randomUUID();
    await database.query(
      "INSERT INTO staff_users(worker_id,username,role,is_active,password_change_required,session_version) VALUES($1,$2,'MANAGER',true,false,0)",
      [other, 'second-manager'],
    );
    expect(
      (
        await new NotificationsService(database).snapshot(other, {
          page: 1,
          pageSize: 20,
        })
      ).unread,
    ).toBe(2);
    await database.query(
      "UPDATE foss_complaints SET status='UNDER_REVIEW' WHERE complaint_id=$1",
      [complaint],
    );
    await read().expect(409);
    expect(((await get().expect(200)).body as Snapshot).unread).toBe(2);
    await database.query(
      "UPDATE foss_complaints SET status='RESOLVED' WHERE complaint_id=$1",
      [complaint],
    );
    await database.query(
      "UPDATE kms_menu_items SET stock_status='AVAILABLE',updated_at=updated_at+interval '1 second' WHERE menu_item_id=$1",
      [stock],
    );
    expect(((await get().expect(200)).body as Snapshot).total).toBe(0);
    await read().expect(404);
  });
  it('persists stock read state without changing KMS or hiding the active issue', async () => {
    const item = ((await get().expect(200)).body as Snapshot).items.find(
      (i) => i.type === 'STOCK',
    )!;
    await request(app.getHttpServer())
      .patch('/mad/notifications/STOCK/' + stock + '/read')
      .set('Authorization', 'Bearer ' + provider.issue('manager'))
      .send({ revision: item.revision })
      .expect(200);
    expect((await get().expect(200)).body as Snapshot).toMatchObject({
      total: 2,
      unread: 1,
    });
    expect(
      await database.query('SELECT stock_status FROM kms_menu_items'),
    ).toEqual([{ stock_status: 'LOW_STOCK' }]);
    await database.query(
      "UPDATE kms_menu_items SET stock_status='UNAVAILABLE',updated_at=updated_at+interval '1 second'",
    );
    expect(((await get().expect(200)).body as Snapshot).unread).toBe(2);
  });
  it('TC-MAD-043-AC3: source invalidation and reconnect retrieve current state without duplicate alerts', async () => {
    const worker = app.get(NotificationsWorker);
    await worker.tick();
    let client: Socket | undefined;
    try {
      client = await socket();
      const update = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('No invalidation')),
          5000,
        );
        client!.once('notifications.changed', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      await database.query("UPDATE foss_complaints SET status='RESOLVED'");
      await worker.tick();
      await update;
      client.disconnect();
      await database.query(
        "UPDATE kms_menu_items SET stock_status='AVAILABLE'",
      );
      client = await socket();
      expect(((await get().expect(200)).body as Snapshot).items).toEqual([]);
    } finally {
      client?.disconnect();
    }
  });
  it('rejects invalid input and unauthorized reads/mutations, and reports denied/corrupt sources explicitly', async () => {
    for (const query of [
      'extra=1',
      'page=0',
      'page=1e2',
      'pageSize=101',
      'page=1&page=2',
    ])
      await get(query).expect(400);
    for (const [token, status] of [
      [null, 401],
      ['bad', 401],
      [provider.issue('worker'), 403],
      [provider.issue('first-login'), 403],
    ] as const) {
      await get('', token).expect(status);
      await read('SUBMITTED:0', token).expect(status);
    }
    await read('bad value').expect(400);
    await request(app.getHttpServer())
      .patch('/mad/notifications/BAD/not-uuid/read')
      .set('Authorization', 'Bearer ' + provider.issue('manager'))
      .send({ revision: '1' })
      .expect(400);
    await expect(
      app
        .get(DataSource)
        .query("UPDATE kms_menu_items SET stock_status='AVAILABLE'"),
    ).rejects.toThrow();
    await database.query(
      `REVOKE SELECT ON mad_notification_reads FROM "${role}"`,
    );
    try {
      expect((await get().expect(503)).body as unknown).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable. Please retry.',
      });
    } finally {
      await database.query(
        `GRANT SELECT ON mad_notification_reads TO "${role}"`,
      );
    }
    await database.query("UPDATE kms_menu_items SET stock_status='UNKNOWN'");
    await get().expect(503);
  });
});
