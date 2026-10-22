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
import { RealtimeModule } from '../src/realtime/realtime.module';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { TaskEventsConsumer } from '../src/realtime/task-events.consumer';
import { ConfigService } from '@nestjs/config';
import { io, Socket } from 'socket.io-client';
import { connect } from 'amqplib';
import { TasksService } from '../src/tasks/tasks.service';
import { seedLocalAuth } from './local-auth-fixture';
type Summary = Awaited<ReturnType<TasksService['snapshot']>>;
describe('DDP-042 task snapshots and updates with disposable PostgreSQL', () => {
  let admin: DataSource,
    database: DataSource,
    app: INestApplication<App>,
    provider: Awaited<ReturnType<typeof seedLocalAuth>>;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12),
    name = 'ddp_tasks_test_' + suffix,
    role = 'ddp_tasks_app_' + suffix;
  const secret = 'worker-integration-only-secret-at-least-32-characters';

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
    await database.query(`CREATE TABLE wkms_tasks(task_id uuid PRIMARY KEY,room_number varchar(10) NOT NULL,category text NOT NULL,priority text NOT NULL,status text NOT NULL,assigned_worker_id uuid REFERENCES staff_users(worker_id),submitted_at timestamptz NOT NULL,completed_at timestamptz,updated_at timestamptz NOT NULL);
      GRANT SELECT ON wkms_tasks,mad_revoked_sessions TO "${role}"`);
    await database.query(readSchemaSection('tasks'));
    await database.query(
      `GRANT SELECT,INSERT,UPDATE ON mad_task_versions,mad_task_events TO "${role}"`,
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
        AuthModule,
        RealtimeModule,
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
  }, 60000);
  beforeEach(async () => {
    await database.query(
      'TRUNCATE wkms_tasks,mad_task_events,mad_task_versions',
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
    const req = request(app.getHttpServer()).get('/mad/tasks?' + query);
    if (token) req.set('Authorization', 'Bearer ' + token);
    return req;
  }
  const taskId = '67f4568c-89ab-4c12-b321-123456789012';
  async function add(id = taskId, status = 'UNASSIGNED') {
    await database.query(
      "INSERT INTO wkms_tasks VALUES ($1,'101','ROOM_CLEANING','HIGH',$2,$3,'2026-10-20T00:00:00Z',CASE WHEN $2='COMPLETED' THEN '2026-10-20T01:00:00Z'::timestamptz ELSE NULL END,'2026-10-20T01:00:00.123456Z')",
      [id, status, status === 'UNASSIGNED' ? null : provider.ids.get('worker')],
    );
  }
  async function socket() {
    const result = await request(app.getHttpServer())
      .post('/mad/realtime/ticket')
      .set('Authorization', 'Bearer ' + provider.issue('manager'))
      .expect(201);
    const client = io(await app.getUrl(), {
      path: '/mad/socket.io',
      transports: ['websocket'],
      auth: { ticket: (result.body as { ticket: string }).ticket },
      extraHeaders: { Origin: 'http://localhost:3000' },
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    return client;
  }
  it('TC-MAD-042-AC1: filters and paginates stable tasks with worker and completion details', async () => {
    for (const state of [
      'UNASSIGNED',
      'ASSIGNED',
      'IN_PROGRESS',
      'COMPLETED',
      'ESCALATED',
    ])
      await add(randomUUID(), state);
    const all = (await get().expect(200)).body as Summary;
    expect(all.total).toBe(5);
    expect(new Set(all.tasks.map((t) => t.status)).size).toBe(5);
    const filtered = (
      await get(
        'status=COMPLETED&worker=' + provider.ids.get('worker') + '&pageSize=1',
      ).expect(200)
    ).body as Summary;
    expect(filtered.tasks[0]).toMatchObject({
      status: 'COMPLETED',
      assignee: { id: provider.ids.get('worker'), name: 'Fixture Staff' },
      priority: 'HIGH',
      category: 'ROOM_CLEANING',
      roomNumber: '101',
    });
    expect(filtered.tasks[0].completedAt).not.toBeNull();
    const first = (await get('pageSize=2').expect(200)).body as Summary;
    const second = (await get('pageSize=2&page=2').expect(200)).body as Summary;
    expect(
      new Set([...first.tasks, ...second.tasks].map((t) => t.id)).size,
    ).toBe(4);
  });
  it('TC-MAD-042-AC3: rejects invalid filters, unauthorized sessions and mutations without changing source rows', async () => {
    await add();
    const before = await database.query<unknown[]>('SELECT * FROM wkms_tasks');
    for (const query of [
      'extra=1',
      'status=BAD',
      'worker=invalid',
      'page=0',
      'pageSize=101',
      'page=1e2',
      'page=0x10',
      'pageSize=1.0',
      'page=1&page=2',
      'status=ASSIGNED&status=COMPLETED',
    ])
      await get(query).expect(400);
    for (const [token, status] of [
      [null, 401],
      ['bad', 401],
      [provider.issue('worker'), 403],
      [provider.issue('first-login'), 403],
    ] as const)
      await get('', token).expect(status);
    for (const action of ['claim', 'assign', 'complete']) {
      for (const [token, status] of [
        [null, 401],
        ['bad', 401],
        [provider.issue('worker'), 403],
        [provider.issue('first-login'), 403],
        [provider.issue('manager'), 403],
      ] as const) {
        const req = request(app.getHttpServer()).post(
          '/mad/tasks/' + taskId + '/' + action,
        );
        if (token) req.set('Authorization', 'Bearer ' + token);
        await req.expect(status);
      }
    }
    await get().expect(200);
    expect(await database.query('SELECT * FROM wkms_tasks')).toEqual(before);
    const runtime = app.get(DataSource);
    await expect(
      runtime.query("UPDATE wkms_tasks SET status='COMPLETED'"),
    ).rejects.toThrow();
    await database.query(`REVOKE SELECT ON wkms_tasks FROM "${role}"`);
    try {
      await get().expect(503);
    } finally {
      await database.query(`GRANT SELECT ON wkms_tasks TO "${role}"`);
    }
  });
  it('TC-MAD-042-AC3: persists duplicates once and supersedes pending old task states', async () => {
    await add();
    const service = app.get(TaskEventsConsumer);
    const room = ((await get().expect(200)).body as Summary).tasks[0];
    const event = {
      eventId: randomUUID(),
      type: 'task.changed' as const,
      taskId,
      version: room.version,
      occurredAt: room.updatedAt,
    };
    await Promise.all([service.accept(event), service.accept(event)]);
    await database.query(
      "UPDATE wkms_tasks SET status='IN_PROGRESS',updated_at=updated_at+interval '1 second' WHERE task_id='67f4568c-89ab-4c12-b321-123456789012'",
    );
    const newer = ((await get().expect(200)).body as Summary).tasks[0];
    await service.accept({
      ...event,
      eventId: randomUUID(),
      version: newer.version,
    });
    const restarted = new TaskEventsConsumer(
      app.get(ConfigService),
      database,
      app.get(RealtimeGateway),
      app.get(TasksService),
    );
    await restarted.accept({ ...event, eventId: randomUUID() });
    const rows = await database.query<
      { payload: { task: { status: string } } }[]
    >('SELECT payload FROM mad_task_events WHERE delivered_at IS NULL');
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.task.status).toBe('IN_PROGRESS');
    expect(
      await database.query('SELECT version FROM mad_task_versions'),
    ).toEqual([{ version: String(newer.version) }]);
    await expect(
      service.accept({
        ...event,
        eventId: randomUUID(),
        version: newer.version + 1,
      }),
    ).rejects.toThrow();
  });
  it('TC-MAD-042-AC2: publishes a committed authoritative task update through RabbitMQ to an authorized socket', async () => {
    const url = process.env.TEST_RABBITMQ_URL;
    if (!url || new URL(url).pathname !== '/mad_test')
      throw new Error('Use an isolated mad_test RabbitMQ virtual host');
    await add(taskId, 'IN_PROGRESS');
    const room = ((await get().expect(200)).body as Summary).tasks[0];
    const config = app.get(ConfigService);
    config.set('RABBITMQ_URL', url);
    config.set('MAD_REALTIME_ENABLED', 'true');
    app.get(TaskEventsConsumer).onModuleInit();
    const connection = await connect(url);
    const channel = await connection.createConfirmChannel();
    let client: Socket | undefined;
    try {
      await channel.assertExchange('hotel.events', 'topic', { durable: true });
      await channel.assertQueue('mad.tasks', {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': 'mad.tasks.dead',
        },
      });
      await channel.bindQueue('mad.tasks', 'hotel.events', 'task.changed');
      client = await socket();
      const event = {
        eventId: randomUUID(),
        type: 'task.changed',
        taskId,
        version: room.version,
        occurredAt: room.updatedAt,
      };
      const received = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Task event not delivered')),
          10000,
        );
        client!.once('task.changed', (value: unknown) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
      channel.publish(
        'hotel.events',
        'task.changed',
        Buffer.from(JSON.stringify(event)),
        { persistent: true, messageId: event.eventId },
      );
      await channel.waitForConfirms();
      expect(await received).toEqual({ ...event, task: room });
      client.disconnect();
      await database.query(
        "UPDATE wkms_tasks SET status='COMPLETED',completed_at=now(),updated_at=clock_timestamp() WHERE task_id=$1",
        [taskId],
      );
      client = await socket();
      const recovered = ((await get().expect(200)).body as Summary).tasks[0];
      expect(recovered).toMatchObject({ id: taskId, status: 'COMPLETED' });
      expect(recovered.version).toBeGreaterThan(room.version);
      expect(recovered.completedAt).not.toBeNull();
    } finally {
      client?.disconnect();
      await channel.close();
      await connection.close();
    }
  }, 20000);
});
