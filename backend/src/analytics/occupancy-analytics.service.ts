import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  BOOKING_TIMEZONE,
  INCLUDED_BOOKING_STATUSES,
} from './booking-analytics.service';
import { MAX_OCCUPANCY_DAYS, OccupancyQueryDto } from './occupancy-query.dto';
import { OCCUPANCY_SQL } from './occupancy.sql';

interface OccupancyRow {
  date: string;
  eligible_rooms: string;
  occupied_rooms: string;
  source_updated_at: Date | null;
  queried_at: Date;
}

@Injectable()
export class OccupancyAnalyticsService {
  constructor(private readonly database: DataSource) {}

  async calendar({ from, to }: OccupancyQueryDto) {
    // DTO validation checks real ISO dates. Cross-field validation happens before
    // database access, outside the source-error handler so invalid input stays 400.
    const start = Date.parse(from);
    const days = (Date.parse(to) - start) / 86_400_000 + 1;
    if (!Number.isInteger(days) || days < 1 || days > MAX_OCCUPANCY_DAYS) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Use an ordered date range of 1 to ${MAX_OCCUPANCY_DAYS} days, including both dates.`,
      });
    }
    try {
      const rows = await this.database.query<OccupancyRow[]>(OCCUPANCY_SQL, [
        from,
        to,
        INCLUDED_BOOKING_STATUSES,
      ]);
      if (rows.length !== days)
        throw new Error('Incomplete occupancy calendar');
      const dates = rows.map((row, index) => {
        const eligibleRooms = Number(row.eligible_rooms);
        const occupiedRooms = Number(row.occupied_rooms);
        const expectedDate = new Date(start + index * 86_400_000)
          .toISOString()
          .slice(0, 10);
        if (
          row.date !== expectedDate ||
          !Number.isSafeInteger(eligibleRooms) ||
          eligibleRooms < 0 ||
          !Number.isSafeInteger(occupiedRooms) ||
          occupiedRooms < 0 ||
          occupiedRooms > eligibleRooms
        )
          throw new Error('Invalid occupancy source result');
        return {
          date: row.date,
          occupiedRooms,
          eligibleRooms,
          rate: eligibleRooms === 0 ? null : occupiedRooms / eligibleRooms,
        };
      });
      return {
        from,
        to,
        timezone: BOOKING_TIMEZONE,
        rangeEndInclusive: true,
        maxRangeDays: MAX_OCCUPANCY_DAYS,
        includedStatuses: [...INCLUDED_BOOKING_STATUSES],
        denominator: 'active_rooms_excluding_maintenance',
        dates,
        freshness: {
          queriedAt: rows[0].queried_at.toISOString(),
          sourceLatestUpdatedAt:
            rows[0].source_updated_at?.toISOString() ?? null,
        },
      };
    } catch {
      // Missing/unreadable provider data must not masquerade as zero occupancy.
      throw new ServiceUnavailableException();
    }
  }
}
