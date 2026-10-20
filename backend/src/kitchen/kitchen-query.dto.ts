import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class KitchenQueryDto {
  @IsOptional()
  @IsIn(['PLACED', 'IN_PREPARATION', 'READY', 'DELIVERED'])
  status?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
