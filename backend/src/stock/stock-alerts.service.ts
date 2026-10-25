import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  STOCK_STATUSES,
  InvalidStockEvent,
  type StockEvent,
  type StockStatus,
  type StockAlert,
  type StockUpdate
} from './stock-event';
export const STOCK_ALERT_COLUMNS = `alert_id AS "alertId",menu_item_id AS "menuItemId",item_name AS name,stock_status AS "stockStatus",active,version::float8 AS version,source_updated_at AS "sourceUpdatedAt",raised_at AS "raisedAt",cleared_at AS "clearedAt"`;
@Injectable()
export class StockAlertsService {
  constructor(private readonly database: DataSource) {}
  async accept(event: StockEvent) {
    await this.database.transaction(async manager => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended('stock:'||$1,0))", [event.menuItemId]);
      const [seen] = await manager.query<{ same: boolean }[]>(
        'SELECT received_payload=$2::jsonb AS same FROM mad_stock_events WHERE event_id=$1',
        [event.eventId, JSON.stringify(event)]
      );
      if (seen) {
        if (!seen.same) throw new InvalidStockEvent('Stock event identity reused');
        return;
      }
      const [source] = await manager.query<
        {
          name: string;
          status: StockStatus;
          updated_at: Date;
          version: string;
        }[]
      >(
        `SELECT name,stock_status::text AS status,updated_at,(extract(epoch FROM updated_at)*1000000)::bigint::text AS version FROM public.kms_menu_items WHERE menu_item_id=$1`,
        [event.menuItemId]
      );
      const version = Number(source?.version);
      if (
        !source ||
        typeof source.name !== 'string' ||
        !source.name.trim() ||
        Array.from(source.name).length > 255 ||
        !STOCK_STATUSES.includes(source.status) ||
        !(source.updated_at instanceof Date) ||
        !Number.isFinite(source.updated_at.getTime()) ||
        !Number.isSafeInteger(version) ||
        version < event.version
      )
        throw new Error('Stock source unavailable or behind event');
      if (version === event.version && source.status !== event.stockStatus)
        throw new InvalidStockEvent('Stock status contradicts committed version');
      const [last] = await manager.query<{ version: string }[]>(
        'SELECT version FROM mad_stock_alerts WHERE menu_item_id=$1 FOR UPDATE',
        [event.menuItemId]
      );
      const stale = Boolean(last && Number(last.version) >= version);
      let payload: StockUpdate | null = null;
      if (!stale) {
        const [saved] = await manager.query<
          (Omit<StockAlert, 'sourceUpdatedAt' | 'raisedAt' | 'clearedAt'> & {
            sourceUpdatedAt: Date;
            raisedAt: Date | null;
            clearedAt: Date | null;
          })[]
        >(
          `INSERT INTO mad_stock_alerts(alert_id,menu_item_id,item_name,stock_status,active,version,source_updated_at,raised_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $5 THEN now() ELSE NULL END)
 ON CONFLICT(menu_item_id) DO UPDATE SET item_name=EXCLUDED.item_name,stock_status=EXCLUDED.stock_status,active=EXCLUDED.active,version=EXCLUDED.version,source_updated_at=EXCLUDED.source_updated_at,
 raised_at=CASE WHEN EXCLUDED.active AND NOT mad_stock_alerts.active THEN now() ELSE mad_stock_alerts.raised_at END,
 cleared_at=CASE WHEN EXCLUDED.active THEN NULL WHEN mad_stock_alerts.active THEN now() ELSE mad_stock_alerts.cleared_at END,updated_at=now()
 RETURNING ${STOCK_ALERT_COLUMNS}`,
          [
            randomUUID(),
            event.menuItemId,
            source.name,
            source.status,
            source.status !== 'AVAILABLE',
            version,
            source.updated_at
          ]
        );
        if (!saved) throw new Error('Missing persisted stock alert');
        const alert: StockAlert = {
          ...saved,
          sourceUpdatedAt: saved.sourceUpdatedAt.toISOString(),
          raisedAt: saved.raisedAt?.toISOString() ?? null,
          clearedAt: saved.clearedAt?.toISOString() ?? null
        };
        payload = {
          eventId: event.eventId,
          type: 'stock.alert.changed',
          menuItemId: event.menuItemId,
          version,
          occurredAt: event.occurredAt,
          alert
        };
        await manager.query(
          "UPDATE mad_stock_events SET delivery_state='superseded' WHERE menu_item_id=$1 AND delivery_state='pending' AND version<$2",
          [event.menuItemId, version]
        );
      }
      await manager.query(
        `INSERT INTO mad_stock_events(event_id,menu_item_id,version,received_payload,payload,delivery_state) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          event.eventId,
          event.menuItemId,
          version,
          JSON.stringify(event),
          payload === null ? null : JSON.stringify(payload),
          stale ? 'superseded' : 'pending'
        ]
      );
    });
  }
}
