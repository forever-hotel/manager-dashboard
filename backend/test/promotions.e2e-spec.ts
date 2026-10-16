import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { configureHttp } from '../src/common/http';
import { migrate } from '../src/database/migrate';
import { PromotionsModule } from '../src/promotions/promotions.module';
import {
  PROMOTION_CLOCK,
  promotionView,
} from '../src/promotions/promotions.service';
import { seedLocalAuth } from './local-auth-fixture';

type Promotion = ReturnType<typeof promotionView>;
describe('DDP-018 protected promotions with disposable PostgreSQL', () => {
  let admin: DataSource, database: DataSource, app: INestApplication<App>;
  let provider: Awaited<ReturnType<typeof seedLocalAuth>>;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const name = 'ddp_promotion_test_' + suffix;
  const role = 'ddp_promotion_app_' + suffix;
  const secret = 'promotion-test-only-secret-at-least-32-characters';
  const roomId = randomUUID(),
    otherRoomId = randomUUID();
  const payload = {
    code: ' autumn_26 ',
    discountType: 'PERCENTAGE',
    discountValue: 25,
    validFrom: '2026-10-01T00:00:00+05:30',
    validUntil: '2026-11-01T00:00:00+05:30',
    roomTypeIds: [roomId],
    maxRedemptions: 10,
  };
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
      readFileSync('test/fixtures/promotion-schema.sql', 'utf8'),
    );
    await migrate(database, role);
    await database.query(
      readFileSync('../deploy/neon-mad-promotions.sql', 'utf8'),
    );
    await database.query(
      `GRANT SELECT,INSERT ON mad_promotion_room_types TO "${role}"`,
    );
    provider = await seedLocalAuth(database, secret, role);
    owner.username = role;
    owner.password = 'integration-only';
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: secret, JWT_ISSUER: 'mad' })],
        }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: owner.toString(),
          synchronize: false,
        }),
        PromotionsModule,
      ],
    })
      .overrideProvider(PROMOTION_CLOCK)
      .useValue(() => new Date('2026-10-16T00:00:00Z'))
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  }, 60000);
  beforeEach(async () => {
    await database.query(
      'TRUNCATE mad_promotion_room_types,mad_promotion_codes,room_types',
    );
    await database.query(
      `INSERT INTO room_types(room_type_id,type_name,price_per_night,max_guests) VALUES ($1,'Suite',15000,2),($2,'Double',9000,2)`,
      [roomId, otherRoomId],
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
  function post(body: object = payload) {
    return request(app.getHttpServer())
      .post('/mad/promotions')
      .set('Authorization', 'Bearer ' + provider.issue('manager'))
      .send(body);
  }
  function get(path: string) {
    return request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer ' + provider.issue('manager'));
  }
  async function counts() {
    const [result] = await database.query<
      { promotions: number; links: number }[]
    >(
      `SELECT (SELECT count(*)::int FROM mad_promotion_codes) promotions,(SELECT count(*)::int FROM mad_promotion_room_types) links`,
    );
    return result;
  }
  it.each(['PERCENTAGE', 'FIXED_AMOUNT'])(
    'TC-MAD-018-AC1: saves %s precisely with associated room types and lifecycle',
    async (discountType) => {
      const result = await post({
        ...payload,
        discountType,
        discountValue: discountType === 'PERCENTAGE' ? 100 : 12345,
        roomTypeIds: [roomId, otherRoomId],
      }).expect(201);
      const body = result.body as Promotion;
      expect(body).toMatchObject({
        code: 'AUTUMN_26',
        discountType,
        discountValue: discountType === 'PERCENTAGE' ? 100 : 12345,
        currency: 'LKR',
        currentRedemptions: 0,
        status: 'ACTIVE',
        lifecycleState: 'ACTIVE',
        validFrom: '2026-09-30T18:30:00.000Z',
      });
      expect(body.roomTypeIds.sort()).toEqual([roomId, otherRoomId].sort());
      expect(await counts()).toEqual({ promotions: 1, links: 2 });
      const detail = await get('/mad/promotions/' + body.id).expect(200);
      expect(detail.body as Promotion).toEqual(body);
    },
  );
  it.each([
    { discountValue: 101 },
    { discountValue: 0 },
    { discountValue: 1.5 },
    { validUntil: '2026-09-01T00:00:00Z' },
    { validFrom: '2026-10-01' },
    { roomTypeIds: [randomUUID()] },
    { roomTypeIds: [] },
    { roomTypeIds: [roomId, roomId] },
    { maxRedemptions: 0 },
    { code: 'bad code' },
    { extra: true },
  ])(
    'TC-MAD-018-AC2: rejects invalid request %j without writes',
    async (change) => {
      const response = await post({ ...payload, ...change }).expect(400);
      expect(response.body as { code: string }).toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(await counts()).toEqual({ promotions: 0, links: 0 });
    },
  );
  it('TC-MAD-018-AC2: rejects normalized duplicates and legacy mixed-case duplicates', async () => {
    await post().expect(201);
    await post({ ...payload, code: 'AUTUMN_26' }).expect(409);
    await database.query(
      "UPDATE mad_promotion_codes SET code_string=' Autumn_26 '",
    );
    await post().expect(409);
    expect(await counts()).toEqual({ promotions: 1, links: 1 });
  });
  it('TC-MAD-018-AC3: concurrent normalized codes commit exactly once', async () => {
    const results = await Promise.all([
      post(),
      post({ ...payload, code: 'AUTUMN_26' }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    expect(await counts()).toEqual({ promotions: 1, links: 1 });
    // Database enforcement also covers other services that bypass API normalization.
    await expect(
      database.query(
        `INSERT INTO mad_promotion_codes(code_string,discount_type,discount_value,valid_from,valid_until,max_redemptions) VALUES (' Autumn_26 ','PERCENTAGE',10,now(),now()+interval '1 day',10)`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
  it('TC-MAD-018-AC4: paginates promotions and room choices and returns 404 for unknown IDs', async () => {
    const created = await post().expect(201);
    const first = await get('/mad/promotions?page=1&pageSize=1').expect(200);
    expect(first.body as { items: Promotion[]; total: number }).toMatchObject({
      total: 1,
      items: [created.body as Promotion],
    });
    const empty = await get('/mad/promotions?page=2&pageSize=1').expect(200);
    expect(empty.body as { items: Promotion[]; total: number }).toMatchObject({
      total: 1,
      items: [],
    });
    const choices = await get('/mad/promotions/room-types?pageSize=1').expect(
      200,
    );
    expect(
      choices.body as { items: { id: string; name: string }[]; total: number },
    ).toMatchObject({ total: 2, items: [{ id: otherRoomId, name: 'Double' }] });
    await get('/mad/promotions/' + randomUUID()).expect(404);
    await get('/mad/promotions/not-a-uuid').expect(400);
    for (const path of ['/mad/promotions', '/mad/promotions/room-types']) {
      for (const query of [
        'page=0',
        'pageSize=101',
        'page=1&page=2',
        'unexpected=true',
      ])
        await get(path + '?' + query).expect(400);
    }
  });
  it('TC-DDP-018-AUTH: every endpoint rejects absent/invalid sessions and disallowed roles without writes', async () => {
    for (const endpoint of [
      '/mad/promotions',
      '/mad/promotions/room-types',
      '/mad/promotions/' + randomUUID(),
    ]) {
      for (const [token, status] of [
        [null, 401],
        ['malformed', 401],
        [provider.issue('worker'), 403],
        [provider.issue('first-login'), 403],
      ] as const) {
        let req = request(app.getHttpServer()).get(endpoint);
        if (token) req = req.set('Authorization', 'Bearer ' + token);
        await req.expect(status);
      }
    }
    for (const [token, status] of [
      [null, 401],
      ['malformed', 401],
      [provider.issue('worker'), 403],
      [provider.issue('first-login'), 403],
    ] as const) {
      let req = request(app.getHttpServer()).post('/mad/promotions');
      if (token) req = req.set('Authorization', 'Bearer ' + token);
      await req.send(payload).expect(status);
    }
    expect(await counts()).toEqual({ promotions: 0, links: 0 });
  });
  it('TC-DDP-018-ATOMIC: association failure rolls back creation and sanitizes the error', async () => {
    await database.query(
      `REVOKE INSERT ON mad_promotion_room_types FROM "${role}"`,
    );
    try {
      const response = await post().expect(503);
      expect(response.body as { code: string }).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
      expect(JSON.stringify(response.body)).not.toContain('permission denied');
      expect(await counts()).toEqual({ promotions: 0, links: 0 });
    } finally {
      await database.query(
        `GRANT INSERT ON mad_promotion_room_types TO "${role}"`,
      );
    }
  });
});
