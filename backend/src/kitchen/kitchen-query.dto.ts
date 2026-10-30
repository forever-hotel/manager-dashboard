import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const pageNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

export class KitchenQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  activeOnly?: string;
  @IsOptional()
  @IsIn(['PLACED', 'IN_PREPARATION', 'READY', 'DELIVERED'])
  status?: string;

  @Transform(pageNumber)
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;

  @Transform(pageNumber)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
