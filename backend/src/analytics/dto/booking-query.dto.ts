import { IsEnum, IsOptional } from 'class-validator';

export type BookingPeriod = 'day' | 'week' | 'month';

export class BookingQueryDto {
  @IsOptional()
  @IsEnum(['day', 'week', 'month'], {
    message: 'period must be one of: day, week, month',
  })
  period?: BookingPeriod = 'week';
}
