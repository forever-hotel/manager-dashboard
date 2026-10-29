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
import { BookingDetailsService } from '../src/analytics/booking-details.service';
import { BookingAnalyticsService } from '../src/analytics/booking-analytics.service';
import { OccupancyAnalyticsService } from '../src/analytics/occupancy-analytics.service';
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
    await database.query(`
      CREATE TABLE mad_booking_analytics(booking_id uuid,check_in_date date,status text,updated_at timestamptz DEFAULT now());
      CREATE TABLE guests(guest_id uuid PRIMARY KEY,full_name text);
      CREATE TABLE room_types(room_type_id uuid PRIMARY KEY,type_name text);
      CREATE TABLE bookings(booking_id uuid PRIMARY KEY,guest_id uuid,room_type_id uuid,check_in_date date,check_out_date date,total_amount integer,source text,status text,created_at timestamptz DEFAULT now());
      CREATE TABLE rooms(room_number text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE mad_occupancy_rooms(room_id text,active_from date,active_to date,updated_at timestamptz DEFAULT now());
      CREATE TABLE mad_occupancy_allocations(room_id text,check_in_date date,check_out_date date,status text,updated_at timestamptz DEFAULT now());
      CREATE TABLE mad_occupancy_maintenance(room_id text,start_date date,end_date date,updated_at timestamptz DEFAULT now());
      GRANT SELECT ON mad_revoked_sessions,guests,room_types,bookings,rooms,mad_booking_analytics,mad_occupancy_rooms,mad_occupancy_allocations,mad_occupancy_maintenance TO "${role}";
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
        BookingDetailsService,
        OccupancyAnalyticsService,
        { provide: BOOKING_CLOCK, useValue: () => clock }
      ]
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  }, 60000);
  beforeEach(async () => {
    await database.query(
      'TRUNCATE mad_booking_analytics,bookings,guests,room_types,rooms,mad_occupancy_rooms,mad_occupancy_allocations,mad_occupancy_maintenance'
    );
  });
  afterAll(async () => {
    await app?.close();
    await provider?.close();
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
  it('TC-MAD-030-AC1: exports exact booking rules and correct attachment headers', async () => {
    await database.query(
      "INSERT INTO mad_booking_analytics VALUES ($1,'2026-10-20','CONFIRMED',now()),($2,'2026-10-20','CANCELLED',now())",
      [randomUUID(), randomUUID()]
    );
    const booking = await get('bookings').expect(200);
    expect(booking.text).toContain('"2026-10-20","1"');
    expect(booking.text).toContain('Date');
    expect(booking.headers['content-type']).toContain('text/csv');
    expect(booking.headers['content-disposition']).toContain('attachment; filename="bookings-');
    expect(booking.headers['cache-control']).toBe('no-store');
  });
  it('TC-MAD-030-AC3: supports empty reports and real PDF attachments for every type', async () => {
    for (const type of ['bookings', 'occupancy']) {
      const query = type === 'occupancy' ? '&from=2026-10-20&to=2026-10-20' : '';
      const csv = await get(type, 'format=csv' + query).expect(200);
      expect(csv.text).toContain(type === 'bookings' ? 'Date' : '"timezone","Asia/Colombo"');
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
});
