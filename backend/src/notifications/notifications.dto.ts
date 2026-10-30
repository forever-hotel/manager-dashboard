import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

const number = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

export class NotificationPageDto {
  @Transform(number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Transform(number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class NotificationIdentityDto {
  @IsIn(['COMPLAINT', 'STOCK']) type!: 'COMPLAINT' | 'STOCK';
  @IsUUID() id!: string;
}

export class ReadNotificationDto {
  @IsString() @Matches(/^[A-Z0-9:_-]{1,100}$/) revision!: string;
}

export class EmptyNotificationQueryDto {}
