import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class TasksQueryDto {
  @IsOptional()
  @IsIn(['UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'ESCALATED'])
  status?: string;

  @IsOptional()
  @IsUUID()
  worker?: string;

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
