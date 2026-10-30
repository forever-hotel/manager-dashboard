import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import {
  CreatePromotionDto,
  NewPromotionDto,
  normalizeCode,
  PromotionPageDto,
  PromotionVersionDto,
  EditPromotionDto
} from './promotion.dto';
import { promotionView, PromotionRow, PromotionsService } from './promotions.service';

const roomId = '11111111-1111-4111-8111-111111111111';
const input: CreatePromotionDto = {
  code: 'SUMMER',
  discountType: 'PERCENTAGE',
  discountValue: 25,
  validFrom: '2026-10-01T00:00:00+05:30',
  validUntil: '2026-11-01T00:00:00+05:30',
  roomTypeIds: [roomId],
  maxRedemptions: 10
};
const now = new Date('2026-10-16T00:00:00Z');
const row: PromotionRow = {
  version: 0,
  deleted_at: null,
  publication_pending: false,
  promo_id: roomId,
  code_string: input.code,
  discount_type: input.discountType,
  discount_value: input.discountValue,
  valid_from: new Date(input.validFrom),
  valid_until: new Date(input.validUntil),
  max_redemptions: 10,
  current_redemptions: 0,
  status: 'ACTIVE',
  created_at: now,
  updated_at: now,
  room_type_ids: [roomId]
};

function setup() {
  const query = jest.fn<Promise<unknown[]>, [string, unknown[]?]>();
  const transaction = jest.fn((first: unknown, second?: (manager: EntityManager) => Promise<unknown>) => {
    const work = (second ?? first) as (manager: EntityManager) => Promise<unknown>;

    return work({ query } as unknown as EntityManager);
  });
  const service = new PromotionsService({ query, transaction } as unknown as DataSource, () => now);

  return { service, query, transaction };
}
describe('DDP-018 promotion validation', () => {
  it('normalizes only ASCII codes and validates positive integer currency/limits', async () => {
    const dto = plainToInstance(CreatePromotionDto, {
      ...input,
      code: ' summer '
    });

    expect(dto.code).toBe('SUMMER');
    expect(await validate(dto)).toHaveLength(0);
    expect(normalizeCode(3)).toBe(3);
    expect(normalizeCode('ÃƒÅ¸')).toBe('ÃƒÅ¸');
  });
  it.each([
    { code: '' },
    { code: 'a b' },
    { code: 'ÃƒÅ¸' },
    { code: 'X'.repeat(51) },
    { discountType: 'OTHER' },
    { discountValue: 0 },
    { discountValue: 1.5 },
    { discountValue: 2147483648 },
    { maxRedemptions: -1 },
    { maxRedemptions: '10' },
    { roomTypeIds: [] },
    { roomTypeIds: ['bad'] },
    { roomTypeIds: [roomId, roomId] },
    { validFrom: '2026-02-30T00:00:00Z' },
    { validUntil: '2026-11-01' },
    { validUntil: '2026-11-01T00:00:00' },
    { extra: true }
  ])('rejects invalid input %j', async change => {
    expect(
      (
        await validate(plainToInstance(CreatePromotionDto, { ...input, ...change }), {
          whitelist: true,
          forbidNonWhitelisted: true
        })
      ).length
    ).toBeGreaterThan(0);
  });
  it('provides bounded pagination defaults and rejects malformed queries', async () => {
    expect(plainToInstance(PromotionPageDto, {})).toEqual({
      page: 1,
      pageSize: 20
    });
    const valid = plainToInstance(PromotionPageDto, {
      page: '2',
      pageSize: '100'
    });

    expect(await validate(valid)).toHaveLength(0);
    for (const change of [{ page: '' }, { page: '1.5' }, { page: ['1', '2'] }, { page: '-1' }, { pageSize: '101' }]) {
      expect((await validate(plainToInstance(PromotionPageDto, change))).length).toBeGreaterThan(0);
    }
  });
});
describe('DDP-018 lifecycle', () => {
  it.each([
    [new Date(row.valid_from.getTime() - 1), {}, 'SCHEDULED'],
    [row.valid_from, {}, 'ACTIVE'],
    [row.valid_until, {}, 'EXPIRED'],
    [now, { current_redemptions: 10 }, 'EXHAUSTED'],
    [now, { status: 'INACTIVE' as const }, 'INACTIVE']
  ])('derives lifecycle at %s with %j', (instant, change, expected) => {
    expect(promotionView({ ...row, ...change }, instant).lifecycleState).toBe(expected);
  });
});
describe('DDP-018 service', () => {
  it.each(['PERCENTAGE', 'FIXED_AMOUNT'] as const)(
    'creates %s and returns only the saved representation',
    async discountType => {
      const { service, query, transaction } = setup();

      query
        .mockResolvedValueOnce([{ room_type_id: roomId }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ ...row, discount_type: discountType }]);
      const result = await service.create({ ...input, discountType });

      expect(result).toMatchObject({
        code: 'SUMMER',
        discountType,
        lifecycleState: 'ACTIVE',
        currency: 'LKR'
      });
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[2][1]).toEqual([
        expect.any(String),
        'SUMMER',
        discountType,
        25,
        row.valid_from,
        row.valid_until,
        10,
        'ACTIVE'
      ]);
    }
  );
  it.each([{ validFrom: 'bad' }, { validUntil: 'bad' }, { validUntil: input.validFrom }, { discountValue: 101 }])(
    'rejects cross-field violation before writes %j',
    async change => {
      const { service, transaction } = setup();

      await expect(service.create({ ...input, ...change })).rejects.toMatchObject({ status: 400 });
      expect(transaction).not.toHaveBeenCalled();
    }
  );
  it('rejects unknown room types and legacy duplicates before insert', async () => {
    const { service, query } = setup();

    query.mockResolvedValueOnce([]);
    await expect(service.create(input)).rejects.toMatchObject({ status: 400 });
    query.mockResolvedValueOnce([{ room_type_id: roomId }]).mockResolvedValueOnce([{ promo_id: roomId }]);
    await expect(service.create(input)).rejects.toMatchObject({ status: 409 });
    expect(query.mock.calls.every(([sql]) => !sql.startsWith('INSERT'))).toBe(true);
  });
  it.each([
    [{ code: '23505' }, 409],
    [{ code: '23503' }, 400],
    [{ code: '23514' }, 400],
    [{ code: '42501' }, 503],
    [null, 503],
    ['private', 503],
    [new Error('private'), 503]
  ])('maps database error %j to %s without leaking details', async (error, status) => {
    const { service, query } = setup();

    query.mockRejectedValue(error);
    await expect(service.detail(roomId)).rejects.toMatchObject({ status });
  });
  it('returns detail or 404', async () => {
    const { service, query } = setup();

    query.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    expect(await service.detail(roomId)).toMatchObject({ id: roomId });
    await expect(service.detail(roomId)).rejects.toMatchObject({ status: 404 });
  });
  it('uses stable paginated snapshots for lists including empty pages', async () => {
    const { service, query, transaction } = setup();

    query.mockResolvedValueOnce([{ total: '1' }]).mockResolvedValueOnce([row]);
    expect(await service.list({ page: 1, pageSize: 20 })).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ id: roomId })]
    });
    expect(transaction).toHaveBeenCalledWith('REPEATABLE READ', expect.any(Function));
    query.mockResolvedValueOnce([{ total: '1' }]).mockResolvedValueOnce([]);
    expect(await service.list({ page: 2, pageSize: 20 })).toMatchObject({
      total: 1,
      items: []
    });
    query
      .mockResolvedValueOnce([{ total: '1' }])
      .mockResolvedValueOnce([{ id: roomId, name: 'Suite', priceMinor: 15000, maxGuests: 2 }]);
    expect(await service.roomTypes({ page: 1, pageSize: 20 })).toMatchObject({
      total: 1,
      currency: 'LKR',
      items: [expect.objectContaining({ id: roomId })]
    });
  });
  it.each(['active', 'inactive', 'scheduled'] as const)(
    'filters %s before pagination and excludes expired records',
    async view => {
      const { service, query } = setup();

      query.mockResolvedValueOnce([{ total: '0' }]).mockResolvedValueOnce([]);
      await service.list({ page: 2, pageSize: 20, view });
      expect(query.mock.calls[0][0]).toContain('p.valid_until > $1');
      expect(query.mock.calls[1][0]).toContain('p.valid_until > $1');
      expect(query.mock.calls[1][1]).toEqual([now, 20, 20]);
      expect(query.mock.calls[1][0]).toContain(view === 'inactive' ? "p.status='INACTIVE'" : "p.status='ACTIVE'");
      if (view !== 'inactive')
        expect(query.mock.calls[1][0]).toContain(view === 'active' ? 'p.valid_from <= $1' : 'p.valid_from > $1');
    }
  );
});

describe('DDP-019 versioned promotion lifecycle', () => {
  it('validates mandatory integer versions and complete edit fields', async () => {
    for (const version of [undefined, null, -1, 1.5, '0', 2147483648]) {
      expect((await validate(plainToInstance(PromotionVersionDto, { version }))).length).toBeGreaterThan(0);
    }
    expect(await validate(plainToInstance(PromotionVersionDto, { version: 0 }))).toHaveLength(0);
    expect(await validate(plainToInstance(EditPromotionDto, { ...input, version: 0 }))).toHaveLength(0);
    expect((await validate(plainToInstance(EditPromotionDto, { version: 0 }))).length).toBeGreaterThan(0);
  });
  it('keeps deleted state distinct from inactive and reports publication work', () => {
    expect(promotionView({ ...row, deleted_at: now, publication_pending: true }, now)).toMatchObject({
      lifecycleState: 'DELETED',
      deletedAt: now.toISOString(),
      publicationStatus: 'PENDING'
    });
  });
  it.each(['activate', 'deactivate', 'delete'] as const)(
    'persists %s and queues an event with the resulting version',
    async action => {
      const { service, query } = setup();
      const updated = {
        ...row,
        version: 1,
        status: action === 'activate' ? ('ACTIVE' as const) : ('INACTIVE' as const),
        deleted_at: action === 'delete' ? now : null
      };

      query
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([updated])
        .mockResolvedValueOnce([]);
      expect(await service.changeState(roomId, 0, action)).toMatchObject({
        version: 1,
        publicationStatus: 'PENDING'
      });
      expect(query.mock.calls[0][0]).toContain('FOR UPDATE OF p');
      expect(query.mock.calls[3][1]).toEqual([
        expect.any(String),
        roomId,
        1,
        action === 'delete' ? 'promotion.deleted' : 'promotion.upsert',
        expect.any(String)
      ]);
    }
  );
  it.each([
    [[], 0, 404],
    [[{ ...row, version: 1 }], 0, 409],
    [[{ ...row, deleted_at: now }], 0, 409],
    [[{ ...row, version: 2147483647 }], 2147483647, 409],
    [[{ ...row, valid_until: now }], 0, 409],
    [[{ ...row, current_redemptions: 10 }], 0, 409]
  ] as const)('rejects ineligible or stale transitions without writes', async (rows, version, status) => {
    const { service, query } = setup();

    query.mockResolvedValueOnce([...rows]);
    await expect(service.changeState(roomId, version, 'activate')).rejects.toMatchObject({ status });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('replaces editable fields and room associations, retaining redemptions', async () => {
    const { service, query } = setup();

    query
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([{ room_type_id: roomId }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...row, version: 1 }])
      .mockResolvedValueOnce([]);
    expect(await service.edit(roomId, { ...input, version: 0 })).toMatchObject({
      version: 1
    });
    expect(query.mock.calls[3][0]).not.toContain('current_redemptions=');
    expect(query.mock.calls[7][0]).toContain('mad_promotion_outbox');
  });
  it('rejects limits below redeemed count, unknown types and conflicting codes', async () => {
    for (const scenario of ['limit', 'room', 'code']) {
      const { service, query } = setup();

      query.mockResolvedValueOnce([{ ...row, current_redemptions: 5 }]);
      if (scenario !== 'limit') query.mockResolvedValueOnce(scenario === 'room' ? [] : [{ room_type_id: roomId }]);
      if (scenario === 'code') query.mockResolvedValueOnce([{ promo_id: 'other' }]);
      await expect(
        service.edit(roomId, {
          ...input,
          version: 0,
          maxRedemptions: scenario === 'limit' ? 1 : 10
        })
      ).rejects.toMatchObject({ status: scenario === 'code' ? 409 : 400 });
      expect(query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
    }
  });
  it('surfaces publication failure so the enclosing transaction rolls back', async () => {
    const { service, query } = setup();

    query
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...row, version: 1 }])
      .mockRejectedValueOnce(new Error('private queue error'));
    await expect(service.changeState(roomId, 0, 'delete')).rejects.toMatchObject({ status: 503 });
  });
});

describe('DDP-020 draft creation and publication visibility', () => {
  it('accepts inactive creation but rejects unknown initial states', async () => {
    expect(await validate(plainToInstance(NewPromotionDto, { ...input, status: 'INACTIVE' }))).toHaveLength(0);
    expect(await validate(plainToInstance(NewPromotionDto, { ...input, status: 'DRAFT' }))).not.toHaveLength(0);
  });
  it('exposes failed publication without disclosing worker errors', () => {
    expect(promotionView({ ...row, publication_pending: true, publication_failed: true }, now).publicationStatus).toBe(
      'FAILED'
    );
    expect(promotionView(row, now).publicationStatus).toBe('NO_PENDING_WORK');
  });
  it('inserts an inactive draft and queues only its inactive snapshot', async () => {
    const { service, query } = setup();

    query
      .mockResolvedValueOnce([{ room_type_id: roomId }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...row, status: 'INACTIVE' }])
      .mockResolvedValueOnce([]);
    const result = await service.create({ ...input, status: 'INACTIVE' });

    expect(result.status).toBe('INACTIVE');
    expect(query.mock.calls[2][1]?.[7]).toBe('INACTIVE');
    expect(JSON.parse(String(query.mock.calls[5][1]?.[4])) as unknown).toMatchObject({
      status: 'INACTIVE',
      version: 0
    });
  });
});
