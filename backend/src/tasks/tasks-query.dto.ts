import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min, IsString, MaxLength, Matches } from 'class-validator';

const pageNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

export class TasksQueryDto {
  @IsOptional()
  @IsIn(['UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'ESCALATED'])
  status?: string;

  @IsOptional()
  @IsUUID()
  worker?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[^\p{Cc}]*$/u)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  workerName?: string;

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
