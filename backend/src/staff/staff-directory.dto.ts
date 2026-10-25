import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Matches, Min } from 'class-validator';
import { STAFF_ROLES } from './create-staff.dto';
const pageNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
export class StaffDirectoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[^\p{Cc}]*$/u)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;
  @IsOptional() @IsIn(STAFF_ROLES) role?: string;
  @IsOptional() @IsIn(['active', 'inactive']) status?: string;
  @Transform(pageNumber) @IsInt() @Min(1) @Max(100000) page = 1;
  @Transform(pageNumber) @IsInt() @Min(1) @Max(100) pageSize = 20;
}
export class StaffDetailQueryDto {}
export class StaffResetDto {
  @IsOptional() @IsInt() @Min(0) @Max(2147483646) version?: number;
}
