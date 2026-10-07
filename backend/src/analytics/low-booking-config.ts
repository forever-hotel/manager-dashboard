export const DEFAULT_LOW_BOOKING_THRESHOLD = 0.4;

export function lowBookingThreshold(value: unknown): number {
  if (value === undefined) return DEFAULT_LOW_BOOKING_THRESHOLD;
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value))
  ) throw new Error('Configuration: LOW_BOOKING_THRESHOLD must be a number from 0 to 1');
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw new Error('Configuration: LOW_BOOKING_THRESHOLD must be a number from 0 to 1');
  return threshold;
}
