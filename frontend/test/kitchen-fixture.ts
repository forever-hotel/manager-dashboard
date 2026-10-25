import type { KitchenSnapshot, KitchenStatus } from '@/lib/kitchen';
export const kitchenOrderId = '67f4568c-89ab-4c12-b321-123456789012';
export function kitchenSnapshot(status: KitchenStatus = 'PLACED'): KitchenSnapshot {
  return {
    orders: [
      {
        id: kitchenOrderId,
        roomNumber: '101',
        mealPeriod: 'LUNCH',
        status,
        placedAt: '2026-10-19T00:00:00Z',
        updatedAt: '2026-10-19T01:00:00Z',
        version: 2,
        itemCount: 3
      }
    ],
    counts: {
      PLACED: 0,
      IN_PREPARATION: 0,
      READY: 0,
      DELIVERED: 0,
      [status]: 1
    },
    total: 1,
    asOf: '2026-10-19T06:00:00Z',
    deliveredSince: '2026-10-18T18:30:00Z',
    page: 1,
    pageSize: 100
  };
}
