import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  HttpException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { STAFF_ROLES } from './create-staff.dto';
import { StaffDirectoryDto } from './staff-directory.dto';
import { StaffProfile } from './staff-profiles.service';
const projection = `s.worker_id AS "staffId",s.full_name AS name,s.vocation,s.email,s.age,s.phone,s.nic,s.username,s.role,
s.is_active AS "isActive",s.password_change_required AS "passwordChangeRequired",s.session_version AS version,
coalesce(d.status,'none') AS "deliveryStatus"`;
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
      if (!row || !Array.isArray(row.items)) throw new Error();
      return { ...row, page: query.page, pageSize: query.pageSize };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
  async get(id: string) {
    try {
      const row = (await this.list(new StaffDirectoryDto(), id)).items[0];
      if (!row) throw new NotFoundException('Staff account not found.');
      return row;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException();
    }
  }
}
