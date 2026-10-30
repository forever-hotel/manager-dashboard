import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

export const ROOM_LABELS = {
  OCCUPIED: 'Occupied',
  VACANT: 'Vacant',
  UNDER_MAINTENANCE: 'Under Maintenance',
  REQUIRES_CLEANING: 'Requires Cleaning'
} as const;
export interface RoomStatus {
  id: string;
  number: string;
  floor: number;
  typeId: string;
  type: string;
  status: keyof typeof ROOM_LABELS;
  label: string;
  updatedAt: string;
  version: number;
}
export const ROOMS_SQL = `SELECT statement_timestamp() AS queried_at,coalesce(jsonb_agg(jsonb_build_object(
'id',r.room_number,'number',r.room_number,'floor',r.floor,'typeId',t.room_type_id,'type',t.type_name,'status',r.status,
'updatedAt',r.updated_at,'version',(extract(epoch FROM r.updated_at)*1000000)::bigint
) ORDER BY r.room_number COLLATE "C") FILTER(WHERE r.room_number IS NOT NULL),'[]'::jsonb) AS rooms
FROM public.rooms r LEFT JOIN public.room_types t ON t.room_type_id=r.room_type_id
WHERE ($1::text IS NULL OR r.room_number=$1)`;

@Injectable()
export class RoomsService {
  constructor(private readonly database: DataSource) {}

  async snapshot(id?: string) {
    try {
      const [row] = await this.database.query<{ queried_at: Date; rooms: RoomStatus[] }[]>(ROOMS_SQL, [id ?? null]);

      if (!row || !Array.isArray(row.rooms)) throw new Error();
      const rooms = row.rooms.map(room => {
        if (
          typeof room.id !== 'string' ||
          !room.id.length ||
          room.id.length > 10 ||
          room.number !== room.id ||
          !Number.isSafeInteger(room.floor) ||
          typeof room.typeId !== 'string' ||
          typeof room.type !== 'string' ||
          !room.type.length ||
          !Object.hasOwn(ROOM_LABELS, room.status) ||
          !Number.isSafeInteger(room.version) ||
          room.version < 0 ||
          !Number.isFinite(Date.parse(room.updatedAt))
        )
          throw new Error();
        return { ...room, label: ROOM_LABELS[room.status] };
      });

      return {
        rooms,
        queriedAt: row.queried_at.toISOString(),
        source: 'FDS',
        readOnly: true
      };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
