import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export function normalizeCode(value: unknown): unknown {
  return typeof value === 'string' && /^[\x20-\x7e]*$/.test(value.trim())
    ? value.trim().toUpperCase()
    : value;
}
export class CreatePromotionDto {
  @Transform(({ value }: { value: unknown }) => normalizeCode(value))
  @Matches(/^[A-Z0-9][A-Z0-9_-]*$/)
  @MaxLength(50)
  code!: string;

  @IsIn(['PERCENTAGE', 'FIXED_AMOUNT'])
  discountType!: 'PERCENTAGE' | 'FIXED_AMOUNT';

  @IsInt()
  @Min(1)
  @Max(2147483647)
  discountValue!: number;

  @IsISO8601({ strict: true })
  @Matches(
    /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/,
  )
  validFrom!: string;

  @IsISO8601({ strict: true })
  @Matches(
    /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/,
  )
  validUntil!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  roomTypeIds!: string[];

  @IsInt()
  @Min(1)
  @Max(2147483647)
  maxRedemptions!: number;
}

function pageNumber(value: unknown) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value)
    ? Number(value)
    : value;
}
export class PromotionPageDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => pageNumber(value))
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => pageNumber(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
