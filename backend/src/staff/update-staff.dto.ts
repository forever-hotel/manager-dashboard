import { Transform } from 'class-transformer';
import { IsEmail, ValidateIf, IsBoolean, IsIn, IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';

import { STAFF_ROLES } from './create-staff.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateStaffDto {
  @IsInt()
  @Min(0)
  @Max(2147483646)
  version!: number;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  @Matches(/^[^\p{Cc}<>]+$/u)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  name?: string;

  @Transform(trim)
  @IsString()
  @Length(1, 100)
  @Matches(/^[^\p{Cc}<>]+$/u)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  vocation?: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @Length(3, 320)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  email?: string;

  @IsInt()
  @Min(1)
  @Max(120)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  age?: number;

  @Transform(trim)
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  phone?: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^(?:[0-9]{9}[VX]|[0-9]{12})$/)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  nic?: string;

  @IsIn(STAFF_ROLES)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  role?: (typeof STAFF_ROLES)[number];
}
