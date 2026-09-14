import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export type StaffRole =
  | 'RECEPTIONIST'
  | 'WORKER'
  | 'KITCHEN_STAFF'
  | 'KITCHEN_MANAGER';

export class CreateStaffDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  fullName!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  vocation!: string;

  @IsNotEmpty()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsInt()
  @Min(18)
  @Max(65)
  age?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  nic?: string;

  @IsNotEmpty()
  @IsEnum(['RECEPTIONIST', 'WORKER', 'KITCHEN_STAFF', 'KITCHEN_MANAGER'], {
    message:
      'role must be one of: RECEPTIONIST, WORKER, KITCHEN_STAFF, KITCHEN_MANAGER',
  })
  role!: StaffRole;
}
