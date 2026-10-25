import { isISO8601, isUUID } from 'class-validator';
export const STOCK_STATUSES = ['AVAILABLE', 'LOW_STOCK', 'UNAVAILABLE', 'TEMPORARILY_DISABLED'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];
export interface StockEvent {
  eventId: string;
  type: 'kitchen.stock.changed';
  menuItemId: string;
  stockStatus: StockStatus;
  version: number;
  occurredAt: string;
}
export interface StockAlert {
  alertId: string;
  menuItemId: string;
  name: string;
  stockStatus: StockStatus;
  active: boolean;
  version: number;
  sourceUpdatedAt: string;
  raisedAt: string | null;
  clearedAt: string | null;
}
export interface StockUpdate {
  eventId: string;
  type: 'stock.alert.changed';
  menuItemId: string;
  version: number;
  occurredAt: string;
  alert: StockAlert;
}
export class InvalidStockEvent extends Error {}
export function parseStockEvent(raw: unknown): StockEvent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new InvalidStockEvent('Invalid stock envelope');
  const e = raw as Record<string, unknown>;
  if (
    e.type !== 'kitchen.stock.changed' ||
    typeof e.eventId !== 'string' ||
    !isUUID(e.eventId) ||
    typeof e.menuItemId !== 'string' ||
    !isUUID(e.menuItemId) ||
    !STOCK_STATUSES.includes(e.stockStatus as StockStatus) ||
    !Number.isSafeInteger(e.version) ||
    Number(e.version) < 0 ||
    typeof e.occurredAt !== 'string' ||
    !isISO8601(e.occurredAt, { strict: true }) ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(e.occurredAt)
  )
    throw new InvalidStockEvent('Invalid stock envelope');
  return {
    eventId: e.eventId.toLowerCase(),
    type: e.type,
    menuItemId: e.menuItemId.toLowerCase(),
    stockStatus: e.stockStatus as StockStatus,
    version: Number(e.version),
    occurredAt: e.occurredAt
  };
}
