import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BOOKING_TIMEZONE, INCLUDED_BOOKING_STATUSES } from './booking-analytics.service';

export const BOOKING_DETAILS_SQL = `
WITH cohort AS (
 SELECT b.*, g.full_name AS guest_name, rt.type_name AS room_type
 FROM public.bookings b
 LEFT JOIN public.guests g USING (guest_id)
 JOIN public.room_types rt USING (room_type_id)
 WHERE b.check_in_date >= ($1::timestamptz AT TIME ZONE $3)::date
 AND b.check_in_date < ($2::timestamptz AT TIME ZONE $3)::date
), recent AS (
 SELECT booking_id::text AS id, guest_name AS "guestName", room_type AS "roomType",
 to_char(check_in_date,'YYYY-MM-DD') AS "checkIn", to_char(check_out_date,'YYYY-MM-DD') AS "checkOut",
 total_amount AS "amountMinor", source::text AS source, status::text AS status
 FROM cohort ORDER BY check_in_date DESC, created_at DESC, booking_id DESC LIMIT $5 OFFSET $6
)
SELECT (SELECT avg(check_out_date-check_in_date)::float8 FROM cohort WHERE status::text=ANY($4::text[])) AS average_nights,
 COALESCE((SELECT json_agg(recent) FROM recent),'[]'::json) AS recent_bookings,
 (SELECT count(*)::text FROM cohort) AS total_bookings
`;

export interface RecentBooking {
  id: string;
  guestName: string | null;
  roomType: string;
  checkIn: string;
  checkOut: string;
  amountMinor: number;
  source: string;
  status: string;
}

@Injectable()
export class BookingDetailsService {
  constructor(private readonly database: DataSource) {}

  async details(start: string, end: string, page = 1, pageSize = 5) {
    try {
      const [row] = await this.database.query<
        { average_nights: number | null; recent_bookings: RecentBooking[]; total_bookings: string }[]
      >(BOOKING_DETAILS_SQL, [
        start,
        end,
        BOOKING_TIMEZONE,
        INCLUDED_BOOKING_STATUSES,
        pageSize,
        (page - 1) * pageSize
      ]);

      if (
        !row ||
        (row.average_nights !== null && (!Number.isFinite(row.average_nights) || row.average_nights <= 0)) ||
        !Array.isArray(row.recent_bookings)
      )
        throw new Error('Invalid booking details');
      const total = Number(row.total_bookings);

      if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid booking total');
      return {
        averageLengthOfStay: row.average_nights,
        recentBookings: row.recent_bookings,
        bookingList: { total, page, pageSize }
      };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
