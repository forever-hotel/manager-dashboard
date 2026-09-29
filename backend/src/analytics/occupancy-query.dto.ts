import { ValidateBy } from 'class-validator';

export const MAX_OCCUPANCY_DAYS = 366;

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const instant = Date.parse(value);
  return (
    Number.isFinite(instant) &&
    new Date(instant).toISOString().slice(0, 10) === value
  );
}

function IsCalendarDate(): PropertyDecorator {
  return ValidateBy({
    name: 'isCalendarDate',
    validator: {
      validate: isCalendarDate,
      defaultMessage: () => '$property must be a real YYYY-MM-DD calendar date',
    },
  });
}

export class OccupancyQueryDto {
  @IsCalendarDate()
  from!: string;

  @IsCalendarDate()
  to!: string;
}
