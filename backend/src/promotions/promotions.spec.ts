import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import {
  CreatePromotionDto,
  normalizeCode,
  PromotionPageDto,
} from './promotion.dto';
import {
  promotionView,
  PromotionRow,
  PromotionsService,
} from './promotions.service';

const roomId = '11111111-1111-4111-8111-111111111111';
const input: CreatePromotionDto = {
  code: 'SUMMER',
  discountType: 'PERCENTAGE',
  discountValue: 25,
  validFrom: '2026-10-01T00:00:00+05:30',
  validUntil: '2026-11-01T00:00:00+05:30',
  roomTypeIds: [roomId],
  maxRedemptions: 10,
};
const now = new Date('2026-10-16T00:00:00Z');
const row: PromotionRow = {
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
  room_type_ids: [roomId],
};
function setup() {
  const query = jest.fn<Promise<unknown[]>, [string, unknown[]?]>();
  const transaction = jest.fn(
    (first: unknown, second?: (manager: EntityManager) => Promise<unknown>) => {
      const work = (second ?? first) as (
        manager: EntityManager,
      ) => Promise<unknown>;
      return work({ query } as unknown as EntityManager);
    },
  );
  const service = new PromotionsService(
    { query, transaction } as unknown as DataSource,
    () => now,
  );
  return { service, query, transaction };
}
describe('DDP-018 promotion validation', () => {
  it('normalizes only ASCII codes and validates positive integer currency/limits', async () => {
    const dto = plainToInstance(CreatePromotionDto, {
      ...input,
      code: ' summer ',
    });
    expect(dto.code).toBe('SUMMER');
    expect(await validate(dto)).toHaveLength(0);
    expect(normalizeCode(3)).toBe(3);
    expect(normalizeCode('ß')).toBe('ß');
  });
  it.each([
    { code: '' },
    { code: 'a b' },
    { code: 'ß' },
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
    { extra: true },
  ])('rejects invalid input %j', async (change) => {
    expect(
      (
        await validate(
          plainToInstance(CreatePromotionDto, { ...input, ...change }),
          { whitelist: true, forbidNonWhitelisted: true },
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it('provides bounded pagination defaults and rejects malformed queries', async () => {
    expect(plainToInstance(PromotionPageDto, {})).toEqual({
      page: 1,
      pageSize: 20,
    });
    const valid = plainToInstance(PromotionPageDto, {
      page: '2',
      pageSize: '100',
    });
    expect(await validate(valid)).toHaveLength(0);
    for (const change of [
      { page: '' },
      { page: '1.5' },
      { page: ['1', '2'] },
      { page: '-1' },
      { pageSize: '101' },
    ]) {
      expect(
        (await validate(plainToInstance(PromotionPageDto, change))).length,
      ).toBeGreaterThan(0);
    }
  });
});
describe('DDP-018 lifecycle', () => {
  it.each([
    [new Date(row.valid_from.getTime() - 1), {}, 'SCHEDULED'],
    [row.valid_from, {}, 'ACTIVE'],
    [row.valid_until, {}, 'EXPIRED'],
    [now, { current_redemptions: 10 }, 'EXHAUSTED'],
    [now, { status: 'INACTIVE' as const }, 'INACTIVE'],
  ])('derives lifecycle at %s with %j', (instant, change, expected) => {
    expect(promotionView({ ...row, ...change }, instant).lifecycleState).toBe(
      expected,
    );
  });
});
describe('DDP-018 service', () => {
  it.each(['PERCENTAGE', 'FIXED_AMOUNT'] as const)(
    'creates %s and returns only the saved representation',
    async (discountType) => {
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
        currency: 'LKR',
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
      ]);
    },
  );
  it.each([
    { validFrom: 'bad' },
    { validUntil: 'bad' },
    { validUntil: input.validFrom },
    { discountValue: 101 },
  ])('rejects cross-field violation before writes %j', async (change) => {
    const { service, transaction } = setup();
    await expect(service.create({ ...input, ...change })).rejects.toMatchObject(
      { status: 400 },
    );
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rejects unknown room types and legacy duplicates before insert', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce([]);
    await expect(service.create(input)).rejects.toMatchObject({ status: 400 });
    query
      .mockResolvedValueOnce([{ room_type_id: roomId }])
      .mockResolvedValueOnce([{ promo_id: roomId }]);
    await expect(service.create(input)).rejects.toMatchObject({ status: 409 });
    expect(query.mock.calls.every(([sql]) => !sql.startsWith('INSERT'))).toBe(
      true,
    );
  });
  it.each([
    [{ code: '23505' }, 409],
    [{ code: '23503' }, 400],
    [{ code: '23514' }, 400],
    [{ code: '42501' }, 503],
    [null, 503],
    ['private', 503],
    [new Error('private'), 503],
  ])(
    'maps database error %j to %s without leaking details',
    async (error, status) => {
      const { service, query } = setup();
      query.mockRejectedValue(error);
      await expect(service.detail(roomId)).rejects.toMatchObject({ status });
    },
  );
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
      items: [expect.objectContaining({ id: roomId })],
    });
    expect(transaction).toHaveBeenCalledWith(
      'REPEATABLE READ',
      expect.any(Function),
    );
    query.mockResolvedValueOnce([{ total: '1' }]).mockResolvedValueOnce([]);
    expect(await service.list({ page: 2, pageSize: 20 })).toMatchObject({
      total: 1,
      items: [],
    });
    query
      .mockResolvedValueOnce([{ total: '1' }])
      .mockResolvedValueOnce([
        { id: roomId, name: 'Suite', priceMinor: 15000, maxGuests: 2 },
      ]);
    expect(await service.roomTypes({ page: 1, pageSize: 20 })).toMatchObject({
      total: 1,
      currency: 'LKR',
      items: [expect.objectContaining({ id: roomId })],
    });
  });
});
