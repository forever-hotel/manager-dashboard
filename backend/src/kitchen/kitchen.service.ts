import {
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { KitchenQueryDto } from './kitchen-query.dto';
import { parseKitchenSnapshot } from './kitchen-snapshot';

export interface KitchenOrder {
  id: string;
  roomNumber: string;
  mealPeriod: string;
  status: string;
  placedAt: string;
  updatedAt: string;
  version: number;
  itemCount: number;
}
export interface KitchenSnapshot {
  orders: KitchenOrder[];
  counts: Record<string, number>;
  total: number;
  asOf: string;
  page: number;
  pageSize: number;
  deliveredSince: string;
}
export const KITCHEN_SQL = `WITH bounds AS (
 SELECT $4::timestamptz AS as_of,
 date_trunc('day',$4::timestamptz AT TIME ZONE 'Asia/Colombo') AT TIME ZONE 'Asia/Colombo' AS delivered_since
), eligible AS MATERIALIZED (
 SELECT o.order_id,o.room_number,o.meal_period,o.status,o.placed_at,o.updated_at FROM public.kms_food_orders o,bounds
 WHERE o.status IN ('PLACED','IN_PREPARATION','READY')
 OR (o.status='DELIVERED' AND o.delivered_at>=delivered_since AND o.delivered_at<=as_of)
), filtered AS (SELECT * FROM eligible WHERE $1::text IS NULL OR status::text=$1),
 page AS (SELECT * FROM filtered ORDER BY placed_at,order_id LIMIT $2 OFFSET $3)
SELECT jsonb_build_object('asOf',as_of,'deliveredSince',delivered_since,
 'invalidSource',(
   EXISTS(SELECT 1 FROM public.kms_food_orders WHERE status IS NULL
     OR status::text NOT IN ('PLACED','IN_PREPARATION','READY','DELIVERED','CANCELLED')
     OR (status='DELIVERED' AND delivered_at IS NULL))
   OR EXISTS(SELECT 1 FROM public.kms_food_order_items i JOIN eligible e ON e.order_id=i.order_id
     WHERE i.quantity IS NULL OR i.quantity<=0)),
 'total',(SELECT count(*) FROM filtered),
 'counts',(SELECT jsonb_object_agg(state,(SELECT count(*) FROM eligible WHERE status::text=state))
   FROM unnest(ARRAY['PLACED','IN_PREPARATION','READY','DELIVERED']) AS state),
 'orders',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',order_id,'roomNumber',room_number,'mealPeriod',meal_period,'status',status,
   'placedAt',placed_at,'updatedAt',updated_at,
   'version',(extract(epoch FROM updated_at)*1000000)::bigint,
   'itemCount',(SELECT coalesce(sum(quantity),0) FROM public.kms_food_order_items i WHERE i.order_id=p.order_id)
 ) ORDER BY placed_at,order_id) FROM page p),'[]'::jsonb)) AS snapshot FROM bounds`;

@Injectable()
export class KitchenService {
  constructor(
    @InjectDataSource()
    private readonly database: DataSource,
    @Optional()
    @Inject('KITCHEN_CLOCK')
    private readonly now: () => Date = () => new Date(),
  ) {}
  async snapshot(query: KitchenQueryDto): Promise<KitchenSnapshot> {
    try {
      const asOf = this.now().toISOString();
      const [row] = await this.database.query<{ snapshot: unknown }[]>(
        KITCHEN_SQL,
        [
          query.status ?? null,
          query.pageSize,
          (query.page - 1) * query.pageSize,
          asOf,
        ],
      );
      return parseKitchenSnapshot(row?.snapshot, query, asOf);
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
