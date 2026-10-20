import { IsOptional, IsUUID } from 'class-validator';
import { BookingQueryDto } from './booking-query.dto';

export class WorkerPerformanceQueryDto extends BookingQueryDto {
  @IsOptional()
  @IsUUID()
  workerId?: string;
}
