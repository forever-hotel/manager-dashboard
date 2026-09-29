import { IsIn } from 'class-validator';

export const BOOKING_PERIODS = ['day', 'week', 'month'] as const;
export type BookingPeriod = (typeof BOOKING_PERIODS)[number];

export class BookingQueryDto {
  @IsIn(BOOKING_PERIODS)
  period: BookingPeriod = 'day';
}
