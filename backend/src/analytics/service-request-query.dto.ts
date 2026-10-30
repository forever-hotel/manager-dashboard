import { Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min } from 'class-validator';
import { BookingQueryDto } from './booking-query.dto';

export class ServiceRequestListQueryDto extends BookingQueryDto {
  @IsIn(['active', 'all'])
  view: 'active' | 'all' = 'all';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;
}
