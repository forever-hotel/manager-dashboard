import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

export const COMPLAINT_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'RESOLVED'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const pageNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;

export class ComplaintQueryDto {
  @IsOptional()
  @Transform(pageNumber)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;
  @IsOptional()
  @Transform(pageNumber)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
  @IsOptional()
  @IsIn(COMPLAINT_STATUSES)
  status?: ComplaintStatus;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  category?: string;
  @IsOptional()
  @IsUUID()
  workerId?: string;
}

export class ResolveComplaintDto {
  @IsInt()
  @Min(0)
  @Max(2147483646)
  version!: number;
  @IsIn(['UNDER_REVIEW', 'RESOLVED'])
  status!: 'UNDER_REVIEW' | 'RESOLVED';
  @Transform(trim)
  @IsString()
  @Length(1, 4000)
  @Matches(/^[\P{Cc}\t\r\n]+$/u)
  note!: string;
}
