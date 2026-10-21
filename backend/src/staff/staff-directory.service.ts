import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isUUID } from 'class-validator';
import { STAFF_ROLES } from './create-staff.dto';
import { StaffDirectoryDto } from './staff-directory.dto';
import { StaffProfile } from './staff-profiles.service';
const projection = `s.worker_id AS "staffId",s.full_name AS name,s.vocation,s.email,s.age,s.phone,s.nic,s.username,s.role,
s.is_active AS "isActive",s.password_change_required AS "passwordChangeRequired",s.session_version AS version,
coalesce(d.status,'none') AS "deliveryStatus"`;
function text(value: unknown, max: number, nullable = false) {
  return (
    (nullable && value === null) ||
    (typeof value === 'string' &&
      (nullable || Boolean(value.trim())) &&
      value.length <= max &&
      !/\p{Cc}/u.test(value))
  );
}
@Injectable()
export class StaffDirectoryService {
  constructor(private readonly database: DataSource) {}
  async list(query: StaffDirectoryDto, id?: string) {
    try {
      const [row] = await this.database.query<
        {
          items: (StaffProfile & { deliveryStatus: string })[];
          total: number;
        }[]
      >(
        `WITH filtered AS MATERIALIZED (
SELECT ${projection} FROM public.staff_users s LEFT JOIN public.mad_staff_deliveries d ON d.worker_id=s.worker_id
WHERE s.role::text=ANY($1::text[]) AND ($2::text IS NULL OR strpos(lower(s.full_name || ' ' || s.email || ' ' || s.username),lower($2))>0)
AND ($3::text IS NULL OR s.role::text=$3) AND ($4::boolean IS NULL OR s.is_active=$4) AND ($7::uuid IS NULL OR s.worker_id=$7)
), page AS (SELECT * FROM filtered ORDER BY lower(name),"staffId" LIMIT $5 OFFSET $6)
SELECT (SELECT count(*)::integer FROM filtered) AS total,coalesce((SELECT jsonb_agg(page ORDER BY lower(name),"staffId") FROM page),'[]'::jsonb) AS items`,
        [
          STAFF_ROLES,
          query.search || null,
          query.role ?? null,
          query.status === undefined ? null : query.status === 'active',
          query.pageSize,
          (query.page - 1) * query.pageSize,
          id ?? null,
        ],
      );
      if (
        !row ||
        !Array.isArray(row.items) ||
        !Number.isSafeInteger(row.total) ||
        row.total < 0 ||
        (id !== undefined && row.total > 1) ||
        row.items.length !==
          Math.min(
            query.pageSize,
            Math.max(0, row.total - (query.page - 1) * query.pageSize),
          )
      )
        throw new Error();
      const seen = new Set<string>();
      const items = row.items.map((item) => {
        if (
          !item ||
          typeof item !== 'object' ||
          typeof item.staffId !== 'string' ||
          !isUUID(item.staffId) ||
          seen.has(item.staffId.toLowerCase()) ||
          (id !== undefined &&
            item.staffId.toLowerCase() !== id.toLowerCase()) ||
          !STAFF_ROLES.includes(item.role) ||
          (query.role !== undefined && item.role !== query.role) ||
          typeof item.isActive !== 'boolean' ||
          (query.status !== undefined &&
            item.isActive !== (query.status === 'active')) ||
          typeof item.passwordChangeRequired !== 'boolean' ||
          !Number.isSafeInteger(item.version) ||
          item.version < 0 ||
          item.version > 2147483647 ||
          !['pending', 'failed', 'sent', 'cancelled', 'none'].includes(
            item.deliveryStatus,
          ) ||
          !text(item.name, 255) ||
          !text(item.vocation, 100) ||
          !text(item.email, 320) ||
          !text(item.username, 100) ||
          !text(item.phone, 20, true) ||
          !text(item.nic, 50, true) ||
          (item.age !== null &&
            (!Number.isSafeInteger(item.age) || item.age < 1 || item.age > 120))
        )
          throw new Error();
        seen.add(item.staffId.toLowerCase());
        return {
          staffId: item.staffId,
          name: item.name,
          vocation: item.vocation,
          email: item.email,
          age: item.age,
          phone: item.phone,
          nic: item.nic,
          username: item.username,
          role: item.role,
          isActive: item.isActive,
          passwordChangeRequired: item.passwordChangeRequired,
          version: item.version,
          deliveryStatus: item.deliveryStatus,
        };
      });
      return {
        items,
        total: row.total,
        page: query.page,
        pageSize: query.pageSize,
      };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
  async get(id: string) {
    const row = (await this.list(new StaffDirectoryDto(), id)).items[0];
    if (!row) throw new NotFoundException('Staff account not found.');
    return row;
  }
}
