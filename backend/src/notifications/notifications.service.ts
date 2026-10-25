import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { isISO8601, isUUID } from 'class-validator';
import { DataSource } from 'typeorm';
import { NotificationPageDto, NotificationIdentityDto } from './notifications.dto';

// Read source state on every reconciliation: neither event delivery nor read state
// is allowed to conceal an unresolved issue. No descriptions or internal notes.
export const ACTIVE_NOTIFICATIONS = `WITH active AS (
 SELECT 'COMPLAINT'::text AS type,c.complaint_id AS id,
 'Complaint: '||c.category AS title,c.status::text AS status,c.submitted_at AS occurred_at,
 c.status::text||':'||COALESCE(s.version,0)::text AS revision
 FROM public.foss_complaints c LEFT JOIN public.mad_complaint_state s USING(complaint_id)
 WHERE c.status::text IN ('SUBMITTED','UNDER_REVIEW')
 UNION ALL
 SELECT 'STOCK',menu_item_id,name,stock_status::text,updated_at,
 (extract(epoch FROM updated_at)*1000000)::bigint::text
 FROM public.kms_menu_items WHERE stock_status::text IN ('LOW_STOCK','UNAVAILABLE','TEMPORARILY_DISABLED')
)`;
const SNAPSHOT_SQL = `${ACTIVE_NOTIFICATIONS}, marked AS (
 SELECT a.*,r.revision=a.revision AS is_read FROM active a
 LEFT JOIN public.mad_notification_reads r ON r.manager_id=$1 AND r.type=a.type AND r.entity_id=a.id
), page AS (SELECT * FROM marked ORDER BY occurred_at DESC,type,id LIMIT $2 OFFSET $3)
SELECT statement_timestamp() AS queried_at,
 (SELECT count(*)::int FROM marked) AS total,
 (SELECT count(*)::int FROM marked WHERE is_read IS NOT TRUE) AS unread,
 (SELECT count(*)::int FROM marked WHERE type='COMPLAINT') AS complaints,
 (SELECT count(*)::int FROM marked WHERE type='STOCK') AS stock,
 EXISTS(SELECT 1 FROM public.foss_complaints WHERE status IS NULL OR status::text NOT IN ('SUBMITTED','UNDER_REVIEW','RESOLVED'))
 OR EXISTS(SELECT 1 FROM public.kms_menu_items WHERE stock_status IS NULL OR stock_status::text NOT IN ('AVAILABLE','LOW_STOCK','UNAVAILABLE','TEMPORARILY_DISABLED')) AS invalid,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('type',type,'sourceId',id,'title',title,'status',status,'occurredAt',occurred_at,'revision',revision,'isRead',COALESCE(is_read,false)) ORDER BY occurred_at DESC,type,id) FROM page),'[]'::jsonb) AS items`;
export interface NotificationItem {
  type: 'COMPLAINT' | 'STOCK';
  sourceId: string;
  title: string;
  status: string;
  occurredAt: string;
  revision: string;
  isRead: boolean;
}
interface Row {
  queried_at: Date;
  total: number;
  unread: number;
  complaints: number;
  stock: number;
  invalid: boolean;
  items: NotificationItem[];
}
function count(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}
@Injectable()
export class NotificationsService {
  constructor(private readonly database: DataSource) {}
  async snapshot(manager: string, page: NotificationPageDto) {
    try {
      const [row] = await this.database.query<Row[]>(SNAPSHOT_SQL, [
        manager,
        page.pageSize,
        (page.page - 1) * page.pageSize
      ]);
      if (
        !row ||
        row.invalid !== false ||
        ![row.total, row.unread, row.complaints, row.stock].every(count) ||
        row.total !== row.complaints + row.stock ||
        row.unread > row.total ||
        !(row.queried_at instanceof Date) ||
        !Number.isFinite(row.queried_at.getTime()) ||
        !Array.isArray(row.items) ||
        row.items.length !== Math.min(page.pageSize, Math.max(0, row.total - (page.page - 1) * page.pageSize))
      )
        throw new Error();
      const seen = new Set<string>();
      const items = row.items.map(item => {
        const key = item?.type + ':' + item?.sourceId;
        if (
          !item ||
          !['COMPLAINT', 'STOCK'].includes(item.type) ||
          typeof item.sourceId !== 'string' ||
          !isUUID(item.sourceId) ||
          seen.has(key.toLowerCase()) ||
          typeof item.title !== 'string' ||
          !item.title.trim() ||
          item.title.length > 265 ||
          /\p{Cc}/u.test(item.title) ||
          typeof item.revision !== 'string' ||
          !/^[A-Z0-9:_-]{1,100}$/.test(item.revision) ||
          typeof item.isRead !== 'boolean' ||
          typeof item.occurredAt !== 'string' ||
          !isISO8601(item.occurredAt, { strict: true }) ||
          !/(Z|[+-]\d{2}:\d{2})$/.test(item.occurredAt) ||
          !(
            item.type === 'COMPLAINT'
              ? ['SUBMITTED', 'UNDER_REVIEW']
              : ['LOW_STOCK', 'UNAVAILABLE', 'TEMPORARILY_DISABLED']
          ).includes(item.status)
        )
          throw new Error();
        seen.add(key.toLowerCase());
        return {
          id: key,
          type: item.type,
          sourceId: item.sourceId,
          title: item.title,
          status: item.status,
          occurredAt: item.occurredAt,
          revision: item.revision,
          isRead: item.isRead,
          href:
            item.type === 'COMPLAINT'
              ? '/complaints?complaintId=' + item.sourceId
              : '/notifications?page=' + page.page + '#stock-' + item.sourceId
        };
      });
      return {
        items,
        total: row.total,
        unread: row.unread,
        counts: { complaints: row.complaints, stock: row.stock },
        page: page.page,
        pageSize: page.pageSize,
        queriedAt: row.queried_at.toISOString()
      };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
  async markRead(manager: string, identity: NotificationIdentityDto, revision: string) {
    try {
      await this.database.transaction(async db => {
        const rows = await db.query<{ entity_id: string }[]>(
          `${ACTIVE_NOTIFICATIONS}
 INSERT INTO public.mad_notification_reads(manager_id,type,entity_id,revision,read_at)
 SELECT $1,type,id,revision,clock_timestamp() FROM active WHERE type=$2 AND id=$3 AND revision=$4
 ON CONFLICT(manager_id,type,entity_id) DO UPDATE SET revision=EXCLUDED.revision,read_at=EXCLUDED.read_at RETURNING entity_id`,
          [manager, identity.type, identity.id, revision]
        );
        if (!rows.length) {
          const current = await db.query<{ id: string }[]>(
            `${ACTIVE_NOTIFICATIONS} SELECT id FROM active WHERE type=$1 AND id=$2`,
            [identity.type, identity.id]
          );
          if (!current.length) throw new NotFoundException('The alert is no longer active.');
          throw new ConflictException('The alert changed. Reload before marking it read.');
        }
      });
      return { read: true };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException();
    }
  }
  async fingerprint() {
    const [row] = await this.database.query<{ revision: string }[]>(`${ACTIVE_NOTIFICATIONS}
 SELECT md5(COALESCE((SELECT string_agg(type||id::text||revision,'|' ORDER BY type,id) FROM active),'')||
 COALESCE((SELECT max(read_at)::text||count(*)::text FROM public.mad_notification_reads),'')) AS revision`);
    if (!row || !/^[a-f0-9]{32}$/.test(row.revision)) throw new Error('Notification source unavailable');
    return row.revision;
  }
}
