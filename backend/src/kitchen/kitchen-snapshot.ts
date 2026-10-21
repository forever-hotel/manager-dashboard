import { isISO8601, isUUID } from 'class-validator';
import type { KitchenSnapshot } from './kitchen.service';
import type { KitchenQueryDto } from './kitchen-query.dto';

export const KITCHEN_STATUSES = [
  'PLACED',
  'IN_PREPARATION',
  'READY',
  'DELIVERED',
] as const;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid source');
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid count');
  return value;
}
function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !isISO8601(value, { strict: true }) ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error('Invalid timestamp');
  return value;
}
function text(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /\p{Cc}/u.test(value)
  )
    throw new Error('Invalid text');
  return value;
}
export function parseKitchenSnapshot(
  raw: unknown,
  query: KitchenQueryDto,
  asOf: string,
): KitchenSnapshot {
  const source = object(raw);
  if (source.invalidSource !== false) throw new Error('Invalid source');
  const sourceCounts = object(source.counts);
  if (
    Object.keys(sourceCounts).length !== 4 ||
    Object.keys(sourceCounts).some(
      (key) =>
        !KITCHEN_STATUSES.includes(key as (typeof KITCHEN_STATUSES)[number]),
    )
  )
    throw new Error('Invalid states');
  const counts = Object.fromEntries(
    KITCHEN_STATUSES.map((status) => [status, count(sourceCounts[status])]),
  );
  const all = count(Object.values(counts).reduce((sum, n) => sum + n, 0));
  const total = count(source.total);
  if (total !== (query.status ? counts[query.status] : all))
    throw new Error('Inconsistent total');
  const sourceAsOf = timestamp(source.asOf);
  const deliveredSince = timestamp(source.deliveredSince);
  const elapsed = Date.parse(sourceAsOf) - Date.parse(deliveredSince);
  if (
    Date.parse(sourceAsOf) !== Date.parse(asOf) ||
    elapsed < 0 ||
    elapsed >= 86400000
  )
    throw new Error('Inconsistent window');
  if (
    !Array.isArray(source.orders) ||
    source.orders.length !==
      Math.min(
        query.pageSize,
        Math.max(0, total - (query.page - 1) * query.pageSize),
      )
  )
    throw new Error('Incomplete page');
  const seen = new Set<string>();
  const pageCounts: Record<string, number> = {};
  const orders = source.orders.map((rawOrder: unknown) => {
    const order = object(rawOrder);
    if (typeof order.id !== 'string' || !isUUID(order.id))
      throw new Error('Invalid order identity');
    const identity = order.id.toLowerCase();
    if (seen.has(identity)) throw new Error('Duplicate order');
    seen.add(identity);
    const status = text(order.status, 20);
    if (
      !KITCHEN_STATUSES.includes(status as (typeof KITCHEN_STATUSES)[number]) ||
      (query.status && status !== query.status)
    )
      throw new Error('Invalid state');
    pageCounts[status] = (pageCounts[status] ?? 0) + 1;
    if (pageCounts[status] > counts[status])
      throw new Error('Inconsistent counts');
    const updatedAt = timestamp(order.updatedAt);
    const version = count(order.version);
    // Date.parse retains milliseconds. Restore the remaining PostgreSQL digits.
    const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(updatedAt)?.[1] ?? '';
    if (
      fraction.length > 6 ||
      version !==
        Date.parse(updatedAt) * 1000 + Number(fraction.padEnd(6, '0').slice(3))
    )
      throw new Error('Inconsistent revision');
    return {
      id: order.id,
      roomNumber: text(order.roomNumber, 10),
      mealPeriod: text(order.mealPeriod, 40),
      status,
      placedAt: timestamp(order.placedAt),
      updatedAt,
      version,
      itemCount: count(order.itemCount),
    };
  });
  // Explicit projection prevents unrelated source fields leaking into the API.
  return {
    orders,
    counts,
    total,
    asOf: sourceAsOf,
    deliveredSince,
    page: query.page,
    pageSize: query.pageSize,
  };
}
