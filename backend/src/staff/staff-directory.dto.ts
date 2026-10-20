import { Type, Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { STAFF_ROLES } from './create-staff.dto';
export class StaffDirectoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  search?: string;
  @IsOptional() @IsIn(STAFF_ROLES) role?: string;
  @IsOptional() @IsIn(['active', 'inactive']) status?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}
export class StaffResetDto {
  @IsOptional() @IsInt() @Min(0) @Max(2147483646) version?: number;
}
