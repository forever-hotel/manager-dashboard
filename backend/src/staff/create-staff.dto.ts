import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export const STAFF_ROLES = [
  'RECEPTIONIST',
  'WORKER',
  'KITCHEN_STAFF',
  'KITCHEN_MANAGER',
] as const;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateStaffDto {
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  @Matches(/^[^\p{Cc}<>]+$/u)
  name!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 100)
  @Matches(/^[^\p{Cc}<>]+$/u)
  vocation!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @Length(3, 320)
  email!: string;

  @IsInt()
  @Min(1)
  @Max(120)
  age!: number;

  @Transform(trim)
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/)
  phone!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^(?:[0-9]{9}[VX]|[0-9]{12})$/)
  nic!: string;

  @IsIn(STAFF_ROLES)
  role!: (typeof STAFF_ROLES)[number];
}
