import { readSchemaSection } from './schema-section';
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
import { PROMOTION_CLOCK, promotionView } from '../src/promotions/promotions.service';
import { seedLocalAuth } from './local-auth-fixture';
import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';
import { PromotionBroker, PromotionMessage } from '../src/promotions/promotion-broker';
import { PromotionPublicationWorker } from '../src/promotions/promotion-publication.worker';

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
    maxRedemptions: 10
  };
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
    await database.query(readFileSync('test/fixtures/promotion-schema.sql', 'utf8'));
    await migrate(database, role);
    await database.query(readSchemaSection('promotions'));
    await database.query(`GRANT SELECT,INSERT ON mad_promotion_room_types TO "${role}"`);
    await database.query(readSchemaSection('promotion-lifecycle'));
    await database.query(readSchemaSection('promotion-publication'));
    await database.query(`GRANT UPDATE ON mad_promotion_outbox TO "${role}"`);
    await database.query(`GRANT SELECT,INSERT ON mad_promotion_outbox TO "${role}";
      GRANT DELETE ON mad_promotion_room_types TO "${role}";
      CREATE TABLE bookings(booking_id uuid PRIMARY KEY,promo_id uuid REFERENCES mad_promotion_codes(promo_id) ON DELETE SET NULL,total_amount integer NOT NULL)`);
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
              MAD_PROMOTIONS_PUBLISH_ENABLED: 'false'
            })
          ]
        }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: owner.toString(),
          synchronize: false
        }),
        PromotionsModule
      ]
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
      'TRUNCATE bookings,mad_promotion_outbox,mad_promotion_room_types,mad_promotion_codes,room_types'
    );
    await database.query(
      `INSERT INTO room_types(room_type_id,type_name,price_per_night,max_guests) VALUES ($1,'Suite',15000,2),($2,'Double',9000,2)`,
      [roomId, otherRoomId]
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
  it('TC-MAD-040-AC2/AC3: reference atomic HW checkout admits only one final redemption and retains history', async () => {
    // This SQL is a contract fixture, not a production HW checkout endpoint.
    const created = (await post({ ...payload, maxRedemptions: 2 }).expect(201)).body as Promotion;
    await database.query('UPDATE mad_promotion_codes SET current_redemptions=1 WHERE promo_id=$1', [created.id]);
    const historicalBooking = randomUUID();
    await database.query('INSERT INTO bookings VALUES ($1,$2,7500)', [historicalBooking, created.id]);
    const reserveAndBook = `WITH reserved AS (
      UPDATE mad_promotion_codes SET current_redemptions=current_redemptions+1
      WHERE promo_id=$1 AND status='ACTIVE' AND deleted_at IS NULL
        AND current_redemptions<max_redemptions
        AND valid_from<=$3::timestamptz AND $3::timestamptz<valid_until
        AND EXISTS(SELECT 1 FROM mad_promotion_room_types r WHERE r.promo_id=$1 AND r.room_type_id=$4)
      RETURNING promo_id
    ) INSERT INTO bookings(booking_id,promo_id,total_amount)
      SELECT $2,promo_id,7500 FROM reserved RETURNING booking_id`;
    const results = await Promise.all(
      [randomUUID(), randomUUID()].map(id =>
        database.query<{ booking_id: string }[]>(reserveAndBook, [created.id, id, '2026-10-16T00:00:00Z', roomId])
      )
    );
    expect(results.map(rows => rows.length).sort()).toEqual([0, 1]);
    expect(
      await database.query('SELECT current_redemptions FROM mad_promotion_codes WHERE promo_id=$1', [created.id])
    ).toEqual([{ current_redemptions: 2 }]);
    await action(created.id, 0, 'delete').expect(200);
    expect(
      await database.query('SELECT booking_id FROM bookings WHERE booking_id=$1', [historicalBooking])
    ).toHaveLength(1);
    expect(await database.query(reserveAndBook, [created.id, randomUUID(), '2026-10-16T00:00:00Z', roomId])).toEqual(
      []
    );
  });
  it('TC-MAD-040-AC3: persists failure and retries the same event after restart without losing pending work', async () => {
    await post().expect(201);
    const config = new ConfigService({
      MAD_PROMOTIONS_PUBLISH_ENABLED: 'true'
    });
    const failed = jest.fn().mockRejectedValue(new Error('HW offline'));
    const runtime = app.get(DataSource);
    const worker = new PromotionPublicationWorker(config, runtime, {
      publish: failed
    } as unknown as PromotionBroker);
    await worker.processOnce();
    const [pending] = await database.query<
      {
        event_id: string;
        published_at: Date | null;
        attempts: number;
        last_error: string;
      }[]
    >('SELECT event_id,published_at,attempts,last_error FROM mad_promotion_outbox');
    expect(pending).toMatchObject({
      published_at: null,
      attempts: 1,
      last_error: 'PROMOTION_PUBLICATION_FAILED'
    });
    const publish = jest.fn().mockResolvedValue(undefined);
    const restarted = new PromotionPublicationWorker(config, runtime, {
      publish
    } as unknown as PromotionBroker);
    await database.query("UPDATE mad_promotion_outbox SET next_attempt_at=now()+interval '1 hour'");
    await restarted.processOnce();
    expect(publish).not.toHaveBeenCalled(); // Durable backoff survives restart.
    await database.query("UPDATE mad_promotion_outbox SET next_attempt_at=now()-interval '1 second'");
    const other = new PromotionPublicationWorker(config, runtime, {
      publish
    } as unknown as PromotionBroker);
    await Promise.all([restarted.processOnce(), other.processOnce()]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ eventId: pending.event_id }));
    expect(await database.query('SELECT event_id FROM mad_promotion_outbox WHERE published_at IS NULL')).toEqual([]);
  });
  it('TC-MAD-040-AC1: routes a committed publication through a real confirmed broker contract queue', async () => {
    const url = process.env.TEST_RABBITMQ_URL;
    if (!url || new URL(url).pathname !== '/mad_test')
      throw new Error('TEST_RABBITMQ_URL must use disposable mad_test vhost');
    const connection = await connect(url);
    const channel = await connection.createChannel();
    try {
      await channel.assertExchange('hotel.events', 'topic', { durable: true });
      const queue = await channel.assertQueue('', { exclusive: true });
      await channel.bindQueue(queue.queue, 'hotel.events', 'promotion.*');
      const created = (await post().expect(201)).body as Promotion;
      const config = new ConfigService({
        MAD_PROMOTIONS_PUBLISH_ENABLED: 'true',
        RABBITMQ_URL: url
      });
      const publisher = new PromotionPublicationWorker(config, app.get(DataSource), new PromotionBroker(config));
      await publisher.processOnce();
      const delivery = await channel.get(queue.queue, { noAck: false });
      expect(delivery).not.toBe(false);
      if (!delivery) throw new Error('Missing committed event');
      const event = JSON.parse(delivery.content.toString()) as PromotionMessage;
      expect(event).toMatchObject({
        type: 'promotion.upsert',
        promotionId: created.id,
        version: 0,
        promotion: {
          code: 'AUTUMN_26',
          discountType: 'PERCENTAGE',
          discountValue: 25,
          roomTypeIds: [roomId]
        }
      });
      expect(delivery.properties.messageId).toBe(event.eventId);
      channel.ack(delivery);
      for (const [version, kind] of [
        [0, 'deactivate'],
        [1, 'delete']
      ] as const) {
        await action(created.id, version, kind).expect(200);
        await publisher.processOnce();
        const next = await channel.get(queue.queue, { noAck: false });
        if (!next) throw new Error('Missing lifecycle publication');
        const update = JSON.parse(next.content.toString()) as PromotionMessage;
        expect(update.version).toBe(version + 1);
        expect(update.type).toBe(kind === 'delete' ? 'promotion.deleted' : 'promotion.upsert');
        expect(update.promotion.status).toBe('INACTIVE');
        if (kind === 'delete') expect(update.promotion.deletedAt).not.toBeNull();
        channel.ack(next);
      }
      expect(await database.query('SELECT event_id FROM mad_promotion_outbox WHERE published_at IS NULL')).toEqual([]);
    } finally {
      await connection.close();
    }
  }, 30000);
  function get(path: string) {
    return request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer ' + provider.issue('manager'));
  }
  async function counts() {
    const [result] = await database.query<{ promotions: number; links: number }[]>(
      `SELECT (SELECT count(*)::int FROM mad_promotion_codes) promotions,(SELECT count(*)::int FROM mad_promotion_room_types) links`
    );
    return result;
  }
  it('TC-MAD-020-AC1: saves a draft inactive atomically and exposes publication failure safely', async () => {
    const created = await post({ ...payload, status: 'INACTIVE' }).expect(201);
    const body = created.body as Promotion;
    expect(body).toMatchObject({
      status: 'INACTIVE',
      lifecycleState: 'INACTIVE',
      version: 0,
      publicationStatus: 'PENDING'
    });
    const outbox = await database.query<{ payload: Promotion }[]>(
      'SELECT payload FROM mad_promotion_outbox WHERE promo_id=$1',
      [body.id]
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0].payload.status).toBe('INACTIVE');
    await database.query(
      "UPDATE mad_promotion_outbox SET last_error='private provider failure',attempts=1 WHERE promo_id=$1",
      [body.id]
    );
    const detail = await get('/mad/promotions/' + body.id).expect(200);
    expect((detail.body as Promotion).publicationStatus).toBe('FAILED');
    expect(JSON.stringify(detail.body)).not.toContain('private');
    await post({ ...payload, code: 'INVALID', status: 'DRAFT' }).expect(400);
    expect(await counts()).toEqual({ promotions: 1, links: 1 });
  });
  it.each(['PERCENTAGE', 'FIXED_AMOUNT'])(
    'TC-MAD-018-AC1: saves %s precisely with associated room types and lifecycle',
    async discountType => {
      const result = await post({
        ...payload,
        discountType,
        discountValue: discountType === 'PERCENTAGE' ? 100 : 12345,
        roomTypeIds: [roomId, otherRoomId]
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
        validFrom: '2026-09-30T18:30:00.000Z'
      });
      expect(body.roomTypeIds.sort()).toEqual([roomId, otherRoomId].sort());
      expect(await counts()).toEqual({ promotions: 1, links: 2 });
      const detail = await get('/mad/promotions/' + body.id).expect(200);
      expect(detail.body as Promotion).toEqual(body);
    }
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
    { extra: true }
  ])('TC-MAD-018-AC2: rejects invalid request %j without writes', async change => {
    const response = await post({ ...payload, ...change }).expect(400);
    expect(response.body as { code: string }).toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    expect(await counts()).toEqual({ promotions: 0, links: 0 });
  });
  it('TC-MAD-018-AC2: rejects normalized duplicates and legacy mixed-case duplicates', async () => {
    await post().expect(201);
    await post({ ...payload, code: 'AUTUMN_26' }).expect(409);
    await database.query("UPDATE mad_promotion_codes SET code_string=' Autumn_26 '");
    await post().expect(409);
    expect(await counts()).toEqual({ promotions: 1, links: 1 });
  });
  it('TC-MAD-018-AC3: concurrent normalized codes commit exactly once', async () => {
    const results = await Promise.all([post(), post({ ...payload, code: 'AUTUMN_26' })]);
    expect(results.map(response => response.status).sort()).toEqual([201, 409]);
    expect(await counts()).toEqual({ promotions: 1, links: 1 });
    // Database enforcement also covers other services that bypass API normalization.
    await expect(
      database.query(
        `INSERT INTO mad_promotion_codes(code_string,discount_type,discount_value,valid_from,valid_until,max_redemptions) VALUES (' Autumn_26 ','PERCENTAGE',10,now(),now()+interval '1 day',10)`
      )
    ).rejects.toMatchObject({ code: '23505' });
  });
  it('TC-MAD-018-AC4: paginates promotions and room choices and returns 404 for unknown IDs', async () => {
    const created = await post().expect(201);
    const first = await get('/mad/promotions?page=1&pageSize=1').expect(200);
    expect(first.body as { items: Promotion[]; total: number }).toMatchObject({
      total: 1,
      items: [created.body as Promotion]
    });
    const empty = await get('/mad/promotions?page=2&pageSize=1').expect(200);
    expect(empty.body as { items: Promotion[]; total: number }).toMatchObject({
      total: 1,
      items: []
    });
    const choices = await get('/mad/promotions/room-types?pageSize=1').expect(200);
    expect(choices.body as { items: { id: string; name: string }[]; total: number }).toMatchObject({
      total: 2,
      items: [{ id: otherRoomId, name: 'Double' }]
    });
    await get('/mad/promotions/' + randomUUID()).expect(404);
    await get('/mad/promotions/not-a-uuid').expect(400);
    for (const path of ['/mad/promotions', '/mad/promotions/room-types']) {
      for (const query of ['page=0', 'pageSize=101', 'page=1&page=2', 'unexpected=true'])
        await get(path + '?' + query).expect(400);
    }
  });
  it('TC-DDP-018-AUTH: every endpoint rejects absent/invalid sessions and disallowed roles without writes', async () => {
    for (const endpoint of ['/mad/promotions', '/mad/promotions/room-types', '/mad/promotions/' + randomUUID()]) {
      for (const [token, status] of [
        [null, 401],
        ['malformed', 401],
        [provider.issue('worker'), 403],
        [provider.issue('first-login'), 403]
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
      [provider.issue('first-login'), 403]
    ] as const) {
      let req = request(app.getHttpServer()).post('/mad/promotions');
      if (token) req = req.set('Authorization', 'Bearer ' + token);
      await req.send(payload).expect(status);
    }
    expect(await counts()).toEqual({ promotions: 0, links: 0 });
  });
  it('TC-DDP-018-ATOMIC: association failure rolls back creation and sanitizes the error', async () => {
    await database.query(`REVOKE INSERT ON mad_promotion_room_types FROM "${role}"`);
    try {
      const response = await post().expect(503);
      expect(response.body as { code: string }).toMatchObject({
        code: 'SERVICE_UNAVAILABLE'
      });
      expect(JSON.stringify(response.body)).not.toContain('permission denied');
      expect(await counts()).toEqual({ promotions: 0, links: 0 });
    } finally {
      await database.query(`GRANT INSERT ON mad_promotion_room_types TO "${role}"`);
    }
  });
  function action(id: string, version: number, kind: 'activate' | 'deactivate' | 'delete') {
    const req =
      kind === 'delete'
        ? request(app.getHttpServer()).delete('/mad/promotions/' + id)
        : request(app.getHttpServer()).post(`/mad/promotions/${id}/${kind}`);
    return req.set('Authorization', 'Bearer ' + provider.issue('manager')).send({ version });
  }
  function edit(id: string, body: object) {
    return request(app.getHttpServer())
      .put('/mad/promotions/' + id)
      .set('Authorization', 'Bearer ' + provider.issue('manager'))
      .send(body);
  }
  async function events(id: string) {
    return database.query<{ promotion_version: number; event_type: string; payload: Promotion }[]>(
      'SELECT promotion_version,event_type,payload FROM mad_promotion_outbox WHERE promo_id=$1 ORDER BY promotion_version',
      [id]
    );
  }
  it('TC-MAD-019-AC1: edits and toggles activation with monotonic versions and durable events', async () => {
    const created = (await post().expect(201)).body as Promotion;
    expect(created.version).toBe(0);
    const updated = (
      await edit(created.id, {
        ...payload,
        code: 'REVISED',
        roomTypeIds: [otherRoomId],
        version: 0
      }).expect(200)
    ).body as Promotion;
    expect(updated).toMatchObject({
      code: 'REVISED',
      roomTypeIds: [otherRoomId],
      version: 1,
      publicationStatus: 'PENDING'
    });
    expect(((await action(created.id, 1, 'deactivate').expect(200)).body as Promotion).lifecycleState).toBe('INACTIVE');
    expect(((await action(created.id, 2, 'activate').expect(200)).body as Promotion).lifecycleState).toBe('ACTIVE');
    expect((await events(created.id)).map(event => event.promotion_version)).toEqual([0, 1, 2, 3]);
    expect((await get('/mad/promotions/' + created.id).expect(200)).body as Promotion).toMatchObject({ version: 3 });
  });
  it('TC-MAD-019-AC2: concurrent same-version changes produce one winner and one conflict', async () => {
    const created = (await post().expect(201)).body as Promotion;
    const results = await Promise.all([action(created.id, 0, 'activate'), action(created.id, 0, 'deactivate')]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect((await events(created.id)).map(event => event.promotion_version)).toEqual([0, 1]);
    await edit(created.id, { ...payload, version: 0 }).expect(409);
    expect(await events(created.id)).toHaveLength(2);
  });
  it('TC-MAD-019-AC2: rejects invalid edits and unknown/stale targets without changing state', async () => {
    const created = (await post().expect(201)).body as Promotion;
    for (const change of [
      { discountValue: 101 },
      { maxRedemptions: 0 },
      { roomTypeIds: [randomUUID()] },
      { validUntil: payload.validFrom },
      { version: -1 },
      { version: '0' },
      { status: 'ACTIVE' }
    ]) {
      await edit(created.id, { ...payload, version: 0, ...change }).expect(400);
    }
    await edit(randomUUID(), { ...payload, version: 0 }).expect(404);
    for (const kind of ['activate', 'deactivate', 'delete'] as const) await action(randomUUID(), 0, kind).expect(404);
    await post({ ...payload, code: 'OTHER' }).expect(201);
    await edit(created.id, { ...payload, code: 'OTHER', version: 0 }).expect(409);
    expect((await get('/mad/promotions/' + created.id).expect(200)).body as Promotion).toMatchObject({
      version: 0,
      code: 'AUTUMN_26'
    });
    expect(await events(created.id)).toHaveLength(1);
  });
  it('TC-MAD-019-AC3: logical deletion retains booking history and associations, blocks reuse/reactivation and queues removal', async () => {
    const created = (await post().expect(201)).body as Promotion;
    const bookingId = randomUUID();
    await database.query('INSERT INTO bookings(booking_id,promo_id,total_amount) VALUES ($1,$2,7500)', [
      bookingId,
      created.id
    ]);
    const removed = (await action(created.id, 0, 'delete').expect(200)).body as Promotion;
    expect(removed).toMatchObject({
      status: 'INACTIVE',
      lifecycleState: 'DELETED',
      version: 1,
      publicationStatus: 'PENDING'
    });
    expect(removed.deletedAt).not.toBeNull();
    const history = await database.query<{ promo_id: string; total_amount: number }[]>(
      'SELECT promo_id,total_amount FROM bookings WHERE booking_id=$1',
      [bookingId]
    );
    expect(history).toEqual([{ promo_id: created.id, total_amount: 7500 }]);
    expect(await counts()).toEqual({ promotions: 1, links: 1 });
    expect(
      (await get('/mad/promotions').expect(200)).body as {
        items: Promotion[];
        total: number;
      }
    ).toMatchObject({ items: [], total: 0 });
    expect((await get('/mad/promotions/' + created.id).expect(200)).body as Promotion).toMatchObject({
      lifecycleState: 'DELETED'
    });
    await action(created.id, 1, 'activate').expect(409);
    await edit(created.id, { ...payload, version: 1 }).expect(409);
    await action(created.id, 1, 'delete').expect(409);
    await post().expect(409);
    expect((await events(created.id))[1]).toMatchObject({
      promotion_version: 1,
      event_type: 'promotion.deleted',
      payload: {
        id: created.id,
        lifecycleState: 'DELETED',
        status: 'INACTIVE'
      }
    });
  });
  it('TC-DDP-019-ATOMIC: an outbox failure rolls back edit, deletion and creation', async () => {
    const created = (await post().expect(201)).body as Promotion;
    await database.query(`REVOKE INSERT ON mad_promotion_outbox FROM "${role}"`);
    try {
      await edit(created.id, {
        ...payload,
        code: 'CHANGED',
        roomTypeIds: [otherRoomId],
        version: 0
      }).expect(503);
      await action(created.id, 0, 'delete').expect(503);
      await post({ ...payload, code: 'NEW' }).expect(503);
      expect((await get('/mad/promotions/' + created.id).expect(200)).body as Promotion).toMatchObject({
        code: 'AUTUMN_26',
        roomTypeIds: [roomId],
        version: 0,
        deletedAt: null
      });
      expect(await counts()).toEqual({ promotions: 1, links: 1 });
      expect(await events(created.id)).toHaveLength(1);
    } finally {
      await database.query(`GRANT INSERT ON mad_promotion_outbox TO "${role}"`);
    }
  });
  it('TC-DDP-019-AUTH: all mutation endpoints enforce auth, version validation and preserve rows', async () => {
    const created = (await post().expect(201)).body as Promotion;
    for (const method of ['edit', 'activate', 'deactivate', 'delete'] as const) {
      const make = () =>
        method === 'edit'
          ? request(app.getHttpServer()).put('/mad/promotions/' + created.id)
          : method === 'delete'
            ? request(app.getHttpServer()).delete('/mad/promotions/' + created.id)
            : request(app.getHttpServer()).post(`/mad/promotions/${created.id}/${method}`);
      for (const [token, status] of [
        [null, 401],
        ['invalid', 401],
        [provider.issue('worker'), 403],
        [provider.issue('first-login'), 403]
      ] as const) {
        let req = make();
        if (token) req = req.set('Authorization', 'Bearer ' + token);
        await req.send(method === 'edit' ? { ...payload, version: 0 } : { version: 0 }).expect(status);
      }
      await make()
        .set('Authorization', 'Bearer ' + provider.issue('manager'))
        .send(method === 'edit' ? payload : {})
        .expect(400);
    }
    expect((await get('/mad/promotions/' + created.id).expect(200)).body as Promotion).toMatchObject({ version: 0 });
    expect(await events(created.id)).toHaveLength(1);
  });
  it('TC-DDP-019-ELIGIBILITY: refuses expired/exhausted activation and preserves redeemed capacity on edit', async () => {
    const created = (await post().expect(201)).body as Promotion;
    await database.query('UPDATE mad_promotion_codes SET current_redemptions=10 WHERE promo_id=$1', [created.id]);
    await action(created.id, 0, 'activate').expect(409);
    await edit(created.id, {
      ...payload,
      maxRedemptions: 9,
      version: 0
    }).expect(400);
    await database.query(
      "UPDATE mad_promotion_codes SET current_redemptions=0,valid_from='2025-01-01T00:00:00Z',valid_until='2025-02-01T00:00:00Z' WHERE promo_id=$1",
      [created.id]
    );
    await action(created.id, 0, 'activate').expect(409);
    expect(await events(created.id)).toHaveLength(1);
    await action(created.id, 0, 'deactivate').expect(200);
    for (const kind of ['activate', 'deactivate', 'delete'] as const) await action(created.id, 0, kind).expect(409);
    expect(await events(created.id)).toHaveLength(2);
  });
});
