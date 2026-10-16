import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CreatePromotionDto, PromotionPageDto } from './promotion.dto';

export const PROMOTION_CLOCK = Symbol('PROMOTION_CLOCK');
export interface PromotionRow {
  promo_id: string;
  code_string: string;
  discount_type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discount_value: number;
  valid_from: Date;
  valid_until: Date;
  max_redemptions: number;
  current_redemptions: number;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: Date;
  updated_at: Date;
  room_type_ids: string[];
}
const select = `SELECT p.*, COALESCE((SELECT array_agg(r.room_type_id ORDER BY r.room_type_id)
  FROM public.mad_promotion_room_types r WHERE r.promo_id=p.promo_id), ARRAY[]::uuid[]) AS room_type_ids
  FROM public.mad_promotion_codes p`;

export function promotionView(row: PromotionRow, now: Date) {
  const lifecycleState =
    row.status === 'INACTIVE'
      ? 'INACTIVE'
      : row.current_redemptions >= row.max_redemptions
        ? 'EXHAUSTED'
        : now >= row.valid_until
          ? 'EXPIRED'
          : now < row.valid_from
            ? 'SCHEDULED'
            : 'ACTIVE';
  return {
    id: row.promo_id,
    code: row.code_string,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    currency: 'LKR',
    validFrom: row.valid_from.toISOString(),
    validUntil: row.valid_until.toISOString(),
    roomTypeIds: row.room_type_ids,
    maxRedemptions: row.max_redemptions,
    currentRedemptions: row.current_redemptions,
    status: row.status,
    lifecycleState,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class PromotionsService {
  constructor(
    @Inject(DataSource)
    private readonly database: {
      transaction: DataSource['transaction'];
      query: DataSource['query'];
    },
    @Inject(PROMOTION_CLOCK) private readonly now: () => Date,
  ) {}

  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : undefined;
      if (code === '23505')
        throw new ConflictException('Promotion code already exists.');
      if (code === '23503' || code === '23514')
        throw new BadRequestException('Invalid promotion or room type.');
      throw new ServiceUnavailableException();
    }
  }

  async create(input: CreatePromotionDto) {
    const start = Date.parse(input.validFrom),
      end = Date.parse(input.validUntil);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      (input.discountType === 'PERCENTAGE' && input.discountValue > 100)
    ) {
      throw new BadRequestException(
        'Use an ordered validity range and a percentage no greater than 100.',
      );
    }
    return this.guarded(() =>
      this.database.transaction(async (manager) => {
        // Check selections without shared-table write privileges. Foreign keys protect
        // associations if a room type is deleted concurrently; the transaction rolls back.
        const types = await manager.query<{ room_type_id: string }[]>(
          'SELECT room_type_id FROM public.room_types WHERE room_type_id=ANY($1::uuid[]) ORDER BY room_type_id',
          [input.roomTypeIds],
        );
        if (types.length !== input.roomTypeIds.length)
          throw new BadRequestException('Unknown room type.');
        // Also recognize legacy mixed-case codes. The normalized unique index protects all writers.
        const duplicate = await manager.query<{ promo_id: string }[]>(
          'SELECT promo_id FROM public.mad_promotion_codes WHERE upper(btrim(code_string))=$1',
          [input.code],
        );
        if (duplicate.length)
          throw new ConflictException('Promotion code already exists.');
        const id = randomUUID();
        await manager.query(
          `INSERT INTO public.mad_promotion_codes
        (promo_id,code_string,discount_type,discount_value,valid_from,valid_until,max_redemptions,current_redemptions,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,0,'ACTIVE')`,
          [
            id,
            input.code,
            input.discountType,
            input.discountValue,
            new Date(start),
            new Date(end),
            input.maxRedemptions,
          ],
        );
        await manager.query(
          `INSERT INTO public.mad_promotion_room_types(promo_id,room_type_id)
        SELECT $1, unnest($2::uuid[])`,
          [id, input.roomTypeIds],
        );
        const rows = await manager.query<PromotionRow[]>(
          select + ' WHERE p.promo_id=$1',
          [id],
        );
        return promotionView(rows[0], this.now());
      }),
    );
  }

  async detail(id: string) {
    return this.guarded(async () => {
      const rows = await this.database.query<PromotionRow[]>(
        select + ' WHERE p.promo_id=$1',
        [id],
      );
      if (!rows.length) throw new NotFoundException('Promotion not found.');
      return promotionView(rows[0], this.now());
    });
  }

  async list(query: PromotionPageDto) {
    return this.guarded(() =>
      this.database.transaction('REPEATABLE READ', async (manager) => {
        const [count] = await manager.query<{ total: string }[]>(
          'SELECT count(*) AS total FROM public.mad_promotion_codes',
        );
        const rows = await manager.query<PromotionRow[]>(
          select +
            ' ORDER BY p.created_at DESC,p.promo_id DESC LIMIT $1 OFFSET $2',
          [query.pageSize, (query.page - 1) * query.pageSize],
        );
        const now = this.now();
        return {
          items: rows.map((row) => promotionView(row, now)),
          total: Number(count.total),
          page: query.page,
          pageSize: query.pageSize,
        };
      }),
    );
  }

  async roomTypes(query: PromotionPageDto) {
    return this.guarded(() =>
      this.database.transaction('REPEATABLE READ', async (manager) => {
        const [count] = await manager.query<{ total: string }[]>(
          'SELECT count(*) AS total FROM public.room_types',
        );
        const rows = await manager.query<
          { id: string; name: string; priceMinor: number; maxGuests: number }[]
        >(
          `SELECT room_type_id AS id,type_name AS name,price_per_night AS "priceMinor",max_guests AS "maxGuests"
        FROM public.room_types ORDER BY type_name,room_type_id LIMIT $1 OFFSET $2`,
          [query.pageSize, (query.page - 1) * query.pageSize],
        );
        return {
          items: rows,
          total: Number(count.total),
          page: query.page,
          pageSize: query.pageSize,
          currency: 'LKR',
        };
      }),
    );
  }
}
