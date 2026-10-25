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
import { ReportsController } from '../src/reports/reports.controller';
import { ReportsService } from '../src/reports/reports.service';
import { BookingAnalyticsService } from '../src/analytics/booking-analytics.service';
import { RevenueAnalyticsService } from '../src/analytics/revenue-analytics.service';
import { FoodAnalyticsService } from '../src/analytics/food-analytics.service';
import { ServiceRequestAnalyticsService } from '../src/analytics/service-request-analytics.service';
import { OccupancyAnalyticsService } from '../src/analytics/occupancy-analytics.service';
import { LowBookingAlertsService } from '../src/analytics/low-booking-alerts.service';
import { WorkerPerformanceService } from '../src/analytics/worker-performance.service';
import { seedLocalAuth } from './local-auth-fixture';

describe('DDP-030 report exports with disposable PostgreSQL', () => {
  let admin: DataSource,
    database: DataSource,
    app: INestApplication<App>,
    provider: Awaited<ReturnType<typeof seedLocalAuth>>;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12),
    name = 'ddp_reports_test_' + suffix,
    role = 'ddp_reports_app_' + suffix;
  const secret = 'worker-integration-only-secret-at-least-32-characters';
  const clock = new Date('2026-10-20T06:00:00Z');
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
    // Relax completion constraints only to test corrupt legacy timestamps.
    await database.query(`CREATE TYPE task_status AS ENUM ('UNASSIGNED','ASSIGNED','IN_PROGRESS','COMPLETED','ESCALATED');
      CREATE TYPE complaint_status AS ENUM ('SUBMITTED','UNDER_REVIEW','RESOLVED');
      CREATE TABLE wkms_tasks(task_id uuid PRIMARY KEY,assigned_worker_id uuid REFERENCES staff_users(worker_id),status task_status NOT NULL,submitted_at timestamptz NOT NULL,completed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE foss_complaints(complaint_id uuid PRIMARY KEY,referenced_worker_id uuid REFERENCES staff_users(worker_id),status complaint_status NOT NULL,submitted_at timestamptz NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
      GRANT SELECT(assigned_worker_id,status,submitted_at,completed_at,updated_at) ON wkms_tasks TO "${role}";
      GRANT SELECT(referenced_worker_id,status,submitted_at,updated_at) ON foss_complaints TO "${role}";
      GRANT SELECT ON mad_revoked_sessions TO "${role}"`);
    await database.query(`
      CREATE TABLE mad_booking_analytics(booking_id uuid,check_in_date date,status text,updated_at timestamptz DEFAULT now());
      CREATE TABLE payments(payment_id uuid PRIMARY KEY,payment_status text,amount bigint,paid_at timestamptz);
      CREATE TABLE kms_food_orders(order_id uuid PRIMARY KEY,status text,placed_at timestamptz,updated_at timestamptz);
      CREATE TABLE kms_food_order_items(order_id uuid,menu_item_id uuid,name text,quantity integer,updated_at timestamptz);
      CREATE TABLE foss_service_requests(request_id uuid PRIMARY KEY,status text,submitted_at timestamptz,completed_at timestamptz,updated_at timestamptz);
      CREATE TABLE mad_occupancy_rooms(room_id text,active_from date,active_to date,updated_at timestamptz DEFAULT now());
      CREATE TABLE mad_occupancy_allocations(room_id text,check_in_date date,check_out_date date,status text,updated_at timestamptz DEFAULT now());
      CREATE TABLE mad_occupancy_maintenance(room_id text,start_date date,end_date date,updated_at timestamptz DEFAULT now());
      GRANT SELECT ON mad_booking_analytics,payments,kms_food_orders,kms_food_order_items,foss_service_requests,mad_occupancy_rooms,mad_occupancy_allocations,mad_occupancy_maintenance TO "${role}";
    `);
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
      controllers: [ReportsController],
      providers: [
        ReportsService,
        BookingAnalyticsService,
        RevenueAnalyticsService,
        FoodAnalyticsService,
        ServiceRequestAnalyticsService,
        OccupancyAnalyticsService,
        LowBookingAlertsService,
        WorkerPerformanceService,
        { provide: BOOKING_CLOCK, useValue: () => clock }
      ]
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  }, 60000);
  beforeEach(async () => {
    await database.query(
      'TRUNCATE wkms_tasks,foss_complaints,mad_booking_analytics,payments,kms_food_orders,kms_food_order_items,foss_service_requests,mad_occupancy_rooms,mad_occupancy_allocations,mad_occupancy_maintenance'
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

  function get(type: string, query = 'format=csv', token: string | null = provider.issue('manager')) {
    const req = request(app.getHttpServer()).get('/mad/reports/' + type + '?' + query);
    if (token) req.set('Authorization', 'Bearer ' + token);
    return req;
  }
  it('TC-MAD-030-AC1: exports exact booking and revenue rules and correct attachment headers', async () => {
    await database.query(
      "INSERT INTO mad_booking_analytics VALUES ($1,'2026-10-20','CONFIRMED',now()),($2,'2026-10-20','CANCELLED',now())",
      [randomUUID(), randomUUID()]
    );
    await database.query(
      "INSERT INTO payments VALUES ($1,'COMPLETED',25000,'2026-10-20T00:00:00Z'),($2,'REFUNDED',5000,'2026-10-20T00:00:00Z')",
      [randomUUID(), randomUUID()]
    );
    const booking = await get('bookings').expect(200);
    expect(booking.text).toContain('"total","1","count"');
    expect(booking.text).toContain('bookings_checking_in');
    expect(booking.headers['content-type']).toContain('text/csv');
    expect(booking.headers['content-disposition']).toContain('attachment; filename="bookings-');
    expect(booking.headers['cache-control']).toBe('no-store');
    const revenue = await get('revenue').expect(200);
    expect(revenue.text).toContain('"currentMinor","25000","LKR cents"');
    expect(revenue.text).toContain('completed_payment_revenue');
  });
  it('TC-MAD-030-AC1/AC2: preserves worker filter, service metrics and escaped food item names', async () => {
    const worker = provider.ids.get('worker');
    const order = randomUUID();
    await database.query(
      "INSERT INTO wkms_tasks(task_id,assigned_worker_id,status,submitted_at,completed_at) VALUES ($1,$2,'COMPLETED','2026-10-20T00:00:00Z','2026-10-20T01:00:00Z')",
      [randomUUID(), worker]
    );
    await database.query("INSERT INTO kms_food_orders VALUES ($1,'PLACED','2026-10-20T00:00:00Z',now())", [order]);
    await database.query('INSERT INTO kms_food_order_items VALUES ($1,$2,$3,2,now())', [
      order,
      randomUUID(),
      '=SUM("x"),\nitem'
    ]);
    await database.query(
      "INSERT INTO foss_service_requests VALUES ($1,'COMPLETED','2026-10-20T00:00:00Z','2026-10-20T01:00:00Z',now())",
      [randomUUID()]
    );
    const workerReport = await get('worker-performance', 'format=csv&workerId=' + worker).expect(200);
    expect(workerReport.text).toContain('"workers[0].completedTaskCount","1","count"');
    expect(workerReport.text).toContain('"workers[0].averageCompletionMinutes","60","minutes"');
    expect((await get('staff', 'format=csv&workerId=' + randomUUID()).expect(200)).text).toContain(
      '"workers","[]","empty"'
    );
    const food = await get('food-orders').expect(200);
    expect(food.text).toContain('"popularItems[0].name","\'=SUM(""x""),\nitem"');
    const requests = await get('service-requests').expect(200);
    expect(requests.text).toContain('"resolution.averageMinutes","60","minutes"');
  });
  it('TC-MAD-030-AC3: supports empty reports and real PDF attachments for every type', async () => {
    for (const type of [
      'bookings',
      'revenue',
      'worker-performance',
      'staff',
      'food-orders',
      'service-requests',
      'occupancy',
      'low-booking-alerts'
    ]) {
      const query = type === 'occupancy' ? '&from=2026-10-20&to=2026-10-20' : '';
      const csv = await get(type, 'format=csv' + query).expect(200);
      expect(csv.text).toContain('"timezone","Asia/Colombo"');
      const pdf = await get(type, 'format=pdf' + query)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
          res.on('error', callback);
        })
        .expect(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect(pdf.headers['content-disposition']).toContain('.pdf');
    }
  }, 30000);
  it('TC-MAD-030-AC3: rejects invalid types, unsupported filters and oversized ranges before exporting', async () => {
    for (const [type, query] of [
      ['unknown', 'format=csv'],
      ['bookings', 'format=xls'],
      ['bookings', 'format=csv&period=year'],
      ['bookings', 'format=csv&from=2026-01-01'],
      ['bookings', 'format=csv&format=pdf'],
      ['staff', 'format=csv&workerId=bad'],
      ['occupancy', 'format=csv&from=2020-01-01&to=2026-10-20']
    ])
      await get(type, query).expect(400);
    for (const [token, status] of [
      [null, 401],
      ['bad', 401],
      [provider.issue('worker'), 403],
      [provider.issue('first-login'), 403]
    ] as const)
      await get('bookings', 'format=csv', token).expect(status);
    await database.query(`REVOKE SELECT ON mad_booking_analytics FROM "${role}"`);
    try {
      await get('bookings').expect(503);
    } finally {
      await database.query(`GRANT SELECT ON mad_booking_analytics TO "${role}"`);
    }
  });
  it('rejects oversized worker cohorts without silently truncating a report', async () => {
    await database.query(
      "INSERT INTO staff_users(worker_id,password_hash,full_name,role,password_change_required) SELECT gen_random_uuid(),'fixture','Report limit '||n,'WORKER',false FROM generate_series(1,200) n"
    );
    try {
      await get('worker-performance').expect(422);
    } finally {
      await database.query("DELETE FROM staff_users WHERE full_name LIKE 'Report limit %'");
    }
  });
});
