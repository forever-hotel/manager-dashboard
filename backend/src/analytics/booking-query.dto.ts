import { IsIn, IsOptional, ValidateBy, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { isCalendarDate } from './occupancy-query.dto';

export const BOOKING_PERIODS = ['day', 'week', 'month'] as const;
export type BookingPeriod = (typeof BOOKING_PERIODS)[number];

export class BookingQueryDto {
  @IsIn(BOOKING_PERIODS)
  period: BookingPeriod = 'day';

  @IsOptional()
  @ValidateBy({ name: 'calendarDate', validator: { validate: value => isCalendarDate(value) } })
  date?: string;
}

export class BookingOverviewQueryDto extends BookingQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;
}
