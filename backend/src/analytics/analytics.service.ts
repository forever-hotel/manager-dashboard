import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { BookingPeriod } from './dto/booking-query.dto';

interface BookingRow {
  date: string;
  count: string;
  revenue: string;
}

interface SourceRow {
  source: string;
  count: string;
}

interface SummaryRow {
  total: string;
  confirmed: string;
  cancelled: string;
  revenue: string;
  avg_stay: string;
}

interface OccupiedRow {
  date: string;
  occupied: string;
}

interface TotalRoomsRow {
  total: string;
}

interface AlertBookingRow {
  date: string;
  count: string;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // MAD-009: Booking Analytics
  // ---------------------------------------------------------------------------
  async getBookingSummary(period: BookingPeriod = 'week') {
    const { fromDate, toDate } = this.getPeriodRange(period);

    this.logger.log(
      `getBookingSummary: period=${period} from=${fromDate} to=${toDate}`,
    );

    // Summary row (totals)
    const summaryRows = await this.dataSource.query<SummaryRow[]>(
      `
      SELECT
        COUNT(*)                                               AS total,
        COUNT(*) FILTER (WHERE status = 'CONFIRMED')           AS confirmed,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')           AS cancelled,
        COALESCE(SUM(total_amount), 0)                         AS revenue,
        COALESCE(AVG(check_out_date - check_in_date), 0)       AS avg_stay
      FROM bookings
      WHERE created_at >= $1 AND created_at < $2
      `,
      [fromDate, toDate],
    );

    // Per-day breakdown
    const dailyRows = await this.dataSource.query<BookingRow[]>(
      `
      SELECT
        created_at::date::text            AS date,
        COUNT(*)                          AS count,
        COALESCE(SUM(total_amount), 0)    AS revenue
      FROM bookings
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY created_at::date
      ORDER BY created_at::date
      `,
      [fromDate, toDate],
    );

    // Bookings by source
    const sourceRows = await this.dataSource.query<SourceRow[]>(
      `
      SELECT source, COUNT(*) AS count
      FROM bookings
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY source
      `,
      [fromDate, toDate],
    );

    const summary = summaryRows[0];

    const bookingsBySource: Record<string, number> = {};
    for (const row of sourceRows) {
      bookingsBySource[row.source] = parseInt(row.count, 10);
    }

    return {
      period,
      from: fromDate,
      to: toDate,
      totalBookings: parseInt(summary.total, 10),
      confirmedBookings: parseInt(summary.confirmed, 10),
      cancelledBookings: parseInt(summary.cancelled, 10),
      totalRevenueLKR: parseInt(summary.revenue, 10),
      avgLengthOfStayNights: parseFloat(
        parseFloat(summary.avg_stay).toFixed(2),
      ),
      bookingsBySource,
      bookingsPerDay: dailyRows.map((r) => ({
        date: r.date,
        count: parseInt(r.count, 10),
        revenueLKR: parseInt(r.revenue, 10),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // MAD-010: Occupancy Heatmap Data
  // ---------------------------------------------------------------------------
  async getOccupancyData(fromParam?: string, toParam?: string) {
    // Default: current month
    const now = new Date();
    const from =
      fromParam ??
      new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split('T')[0];
    const to =
      toParam ??
      new Date(now.getFullYear(), now.getMonth() + 1, 0)
        .toISOString()
        .split('T')[0];

    this.logger.log(`getOccupancyData: from=${from} to=${to}`);

    // Total rooms in the hotel
    const totalRoomsRows =
      await this.dataSource.query<TotalRoomsRow[]>(`SELECT COUNT(*) AS total FROM rooms`);
    const totalRooms = parseInt(totalRoomsRows[0].total, 10) || 1; // avoid division by zero

    // For each date in range, count bookings that overlap that date with CHECKED_IN or CONFIRMED status
    const occupiedRows = await this.dataSource.query<OccupiedRow[]>(
      `
      SELECT
        d.date::text                                        AS date,
        COUNT(b.booking_id)                                 AS occupied
      FROM generate_series($1::date, $2::date, '1 day'::interval) AS d(date)
      LEFT JOIN bookings b
        ON  b.check_in_date  <= d.date
        AND b.check_out_date >  d.date
        AND b.status IN ('CONFIRMED', 'CHECKED_IN')
      GROUP BY d.date
      ORDER BY d.date
      `,
      [from, to],
    );

    return {
      from,
      to,
      totalRooms,
      data: occupiedRows.map((r) => {
        const roomsOccupied = parseInt(r.occupied, 10);
        return {
          date: r.date,
          roomsOccupied,
          occupancyRate: parseFloat((roomsOccupied / totalRooms).toFixed(4)),
        };
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // MAD-011: Low-Booking Alerts
  // ---------------------------------------------------------------------------
  async getLowBookingAlerts() {
    const threshold =
      parseFloat(
        this.configService.get<string>('LOW_BOOKING_THRESHOLD') ?? '0.4',
      ) || 0.4;

    const today = new Date();
    const fromDate = today.toISOString().split('T')[0];
    const toDate = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    this.logger.log(
      `getLowBookingAlerts: threshold=${threshold} range=${fromDate}→${toDate}`,
    );

    const totalRoomsRows =
      await this.dataSource.query<TotalRoomsRow[]>(`SELECT COUNT(*) AS total FROM rooms`);
    const totalRooms = parseInt(totalRoomsRows[0].total, 10) || 1;

    const rows = await this.dataSource.query<AlertBookingRow[]>(
      `
      SELECT
        d.date::text    AS date,
        COUNT(b.booking_id) AS count
      FROM generate_series($1::date, $2::date, '1 day'::interval) AS d(date)
      LEFT JOIN bookings b
        ON  b.check_in_date  <= d.date
        AND b.check_out_date >  d.date
        AND b.status IN ('CONFIRMED', 'CHECKED_IN', 'PENDING')
      GROUP BY d.date
      ORDER BY d.date
      `,
      [fromDate, toDate],
    );

    const alerts = rows
      .map((r) => {
        const roomsBooked = parseInt(r.count, 10);
        const rate = roomsBooked / totalRooms;
        return { date: r.date, expectedOccupancyRate: parseFloat(rate.toFixed(4)), roomsBooked };
      })
      .filter((a) => a.expectedOccupancyRate < threshold);

    return { threshold, alerts };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private getPeriodRange(period: BookingPeriod): { fromDate: string; toDate: string } {
    const now = new Date();
    let from: Date;
    let to: Date;

    switch (period) {
      case 'day':
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
        break;
      case 'month':
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;
      case 'week':
      default: {
        // Monday-based week
        const day = now.getDay(); // 0=Sun
        const diff = day === 0 ? -6 : 1 - day;
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
        to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;
      }
    }

    return {
      fromDate: from.toISOString().split('T')[0],
      toDate: to.toISOString().split('T')[0],
    };
  }
}
