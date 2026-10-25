import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { CreatePromotionDto, NewPromotionDto, PromotionPageDto, EditPromotionDto } from './promotion.dto';

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
  version: number;
  deleted_at: Date | null;
  publication_pending: boolean;
  publication_failed?: boolean;
}
const select = `SELECT p.*, EXISTS(SELECT 1 FROM public.mad_promotion_outbox o
  WHERE o.promo_id=p.promo_id AND o.published_at IS NULL AND o.last_error IS NOT NULL) AS publication_failed, EXISTS(SELECT 1 FROM public.mad_promotion_outbox o
  WHERE o.promo_id=p.promo_id AND o.published_at IS NULL) AS publication_pending, COALESCE((SELECT array_agg(r.room_type_id ORDER BY r.room_type_id)
  FROM public.mad_promotion_room_types r WHERE r.promo_id=p.promo_id), ARRAY[]::uuid[]) AS room_type_ids
  FROM public.mad_promotion_codes p`;

export function promotionView(row: PromotionRow, now: Date) {
  const lifecycleState = row.deleted_at
    ? 'DELETED'
    : row.status === 'INACTIVE'
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
    version: row.version,
    deletedAt: row.deleted_at?.toISOString() ?? null,
    publicationStatus: row.publication_failed ? 'FAILED' : row.publication_pending ? 'PENDING' : 'NO_PENDING_WORK',
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
    updatedAt: row.updated_at.toISOString()
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
    @Inject(PROMOTION_CLOCK) private readonly now: () => Date
  ) {}

  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (code === '23505') throw new ConflictException('Promotion code already exists.');
      if (code === '23503' || code === '23514') throw new BadRequestException('Invalid promotion or room type.');
      throw new ServiceUnavailableException();
    }
  }

  private validateTerms(input: CreatePromotionDto) {
    const start = Date.parse(input.validFrom),
      end = Date.parse(input.validUntil);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      (input.discountType === 'PERCENTAGE' && input.discountValue > 100)
    ) {
      throw new BadRequestException('Use an ordered validity range and a percentage no greater than 100.');
    }
    return { start, end };
  }

  async create(input: NewPromotionDto) {
    const { start, end } = this.validateTerms(input);
    return this.guarded(() =>
      this.database.transaction(async manager => {
        // Check selections without shared-table write privileges. Foreign keys protect
        // associations if a room type is deleted concurrently; the transaction rolls back.
        const types = await manager.query<{ room_type_id: string }[]>(
          'SELECT room_type_id FROM public.room_types WHERE room_type_id=ANY($1::uuid[]) ORDER BY room_type_id',
          [input.roomTypeIds]
        );
        if (types.length !== input.roomTypeIds.length) throw new BadRequestException('Unknown room type.');
        // Also recognize legacy mixed-case codes. The normalized unique index protects all writers.
        const duplicate = await manager.query<{ promo_id: string }[]>(
          'SELECT promo_id FROM public.mad_promotion_codes WHERE upper(btrim(code_string))=$1',
          [input.code]
        );
        if (duplicate.length) throw new ConflictException('Promotion code already exists.');
        const id = randomUUID();
        await manager.query(
          `INSERT INTO public.mad_promotion_codes
        (promo_id,code_string,discount_type,discount_value,valid_from,valid_until,max_redemptions,current_redemptions,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8)`,
          [
            id,
            input.code,
            input.discountType,
            input.discountValue,
            new Date(start),
            new Date(end),
            input.maxRedemptions,
            input.status ?? 'ACTIVE'
          ]
        );
        await manager.query(
          `INSERT INTO public.mad_promotion_room_types(promo_id,room_type_id)
        SELECT $1, unnest($2::uuid[])`,
          [id, input.roomTypeIds]
        );
        const rows = await manager.query<PromotionRow[]>(select + ' WHERE p.promo_id=$1', [id]);
        const view = promotionView({ ...rows[0], publication_pending: true }, this.now());
        await this.enqueue(manager, view);
        return view;
      })
    );
  }

  private async enqueue(manager: EntityManager, view: ReturnType<typeof promotionView>) {
    await manager.query(
      `INSERT INTO public.mad_promotion_outbox
      (event_id,promo_id,promotion_version,event_type,payload)
      VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        randomUUID(),
        view.id,
        view.version,
        view.deletedAt ? 'promotion.deleted' : 'promotion.upsert',
        JSON.stringify(view)
      ]
    );
  }

  private async locked(manager: EntityManager, id: string, version: number) {
    const rows = await manager.query<PromotionRow[]>(select + ' WHERE p.promo_id=$1 FOR UPDATE OF p', [id]);
    const row = rows[0];
    if (!row) throw new NotFoundException('Promotion not found.');
    if (row.version !== version) throw new ConflictException('Promotion changed. Reload before retrying.');
    if (row.deleted_at) throw new ConflictException('Deleted promotions cannot be changed.');
    if (row.version >= 2147483647) throw new ConflictException('Promotion version limit reached.');
    return row;
  }

  private async changed(manager: EntityManager, id: string, now: Date) {
    const [row] = await manager.query<PromotionRow[]>(select + ' WHERE p.promo_id=$1', [id]);
    const view = promotionView({ ...row, publication_pending: true }, now);
    await this.enqueue(manager, view);
    return view;
  }

  async edit(id: string, input: EditPromotionDto) {
    const { start, end } = this.validateTerms(input);
    return this.guarded(() =>
      this.database.transaction(async manager => {
        const row = await this.locked(manager, id, input.version);
        if (input.maxRedemptions < row.current_redemptions)
          throw new BadRequestException('Limit cannot be below completed redemptions.');
        const types = await manager.query<{ room_type_id: string }[]>(
          'SELECT room_type_id FROM public.room_types WHERE room_type_id=ANY($1::uuid[])',
          [input.roomTypeIds]
        );
        if (types.length !== input.roomTypeIds.length) throw new BadRequestException('Unknown room type.');
        const duplicate = await manager.query<{ promo_id: string }[]>(
          'SELECT promo_id FROM public.mad_promotion_codes WHERE upper(btrim(code_string))=$1 AND promo_id<>$2',
          [input.code, id]
        );
        if (duplicate.length) throw new ConflictException('Promotion code already exists.');
        const now = this.now();
        await manager.query(
          `UPDATE public.mad_promotion_codes SET code_string=$2,discount_type=$3,
        discount_value=$4,valid_from=$5,valid_until=$6,max_redemptions=$7,version=version+1,updated_at=$8
        WHERE promo_id=$1`,
          [
            id,
            input.code,
            input.discountType,
            input.discountValue,
            new Date(start),
            new Date(end),
            input.maxRedemptions,
            now
          ]
        );
        await manager.query('DELETE FROM public.mad_promotion_room_types WHERE promo_id=$1', [id]);
        await manager.query(
          'INSERT INTO public.mad_promotion_room_types(promo_id,room_type_id) SELECT $1,unnest($2::uuid[])',
          [id, input.roomTypeIds]
        );
        return this.changed(manager, id, now);
      })
    );
  }

  async changeState(id: string, version: number, action: 'activate' | 'deactivate' | 'delete') {
    return this.guarded(() =>
      this.database.transaction(async manager => {
        const row = await this.locked(manager, id, version);
        const now = this.now();
        if (action === 'activate' && (row.valid_until <= now || row.current_redemptions >= row.max_redemptions)) {
          throw new ConflictException('Expired or exhausted promotions cannot be activated.');
        }
        await manager.query(
          `UPDATE public.mad_promotion_codes SET status=$2,deleted_at=$3,
        version=version+1,updated_at=$4 WHERE promo_id=$1`,
          [id, action === 'activate' ? 'ACTIVE' : 'INACTIVE', action === 'delete' ? now : null, now]
        );
        return this.changed(manager, id, now);
      })
    );
  }

  async detail(id: string) {
    return this.guarded(async () => {
      const rows = await this.database.query<PromotionRow[]>(select + ' WHERE p.promo_id=$1', [id]);
      if (!rows.length) throw new NotFoundException('Promotion not found.');
      return promotionView(rows[0], this.now());
    });
  }

  async list(query: PromotionPageDto) {
    return this.guarded(() =>
      this.database.transaction('REPEATABLE READ', async manager => {
        const [count] = await manager.query<{ total: string }[]>(
          'SELECT count(*) AS total FROM public.mad_promotion_codes WHERE deleted_at IS NULL'
        );
        const rows = await manager.query<PromotionRow[]>(
          select + ' WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC,p.promo_id DESC LIMIT $1 OFFSET $2',
          [query.pageSize, (query.page - 1) * query.pageSize]
        );
        const now = this.now();
        return {
          items: rows.map(row => promotionView(row, now)),
          total: Number(count.total),
          page: query.page,
          pageSize: query.pageSize
        };
      })
    );
  }

  async roomTypes(query: PromotionPageDto) {
    return this.guarded(() =>
      this.database.transaction('REPEATABLE READ', async manager => {
        const [count] = await manager.query<{ total: string }[]>('SELECT count(*) AS total FROM public.room_types');
        const rows = await manager.query<{ id: string; name: string; priceMinor: number; maxGuests: number }[]>(
          `SELECT room_type_id AS id,type_name AS name,price_per_night AS "priceMinor",max_guests AS "maxGuests"
        FROM public.room_types ORDER BY type_name,room_type_id LIMIT $1 OFFSET $2`,
          [query.pageSize, (query.page - 1) * query.pageSize]
        );
        return {
          items: rows,
          total: Number(count.total),
          page: query.page,
          pageSize: query.pageSize,
          currency: 'LKR'
        };
      })
    );
  }
}
