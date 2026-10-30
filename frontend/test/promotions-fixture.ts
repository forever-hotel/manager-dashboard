import type { Promotion, RoomType } from '@/lib/promotions';

export const room: RoomType = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Suite',
  priceMinor: 10000,
  maxGuests: 2
};
export const promotion = (changes: Partial<Promotion> = {}): Promotion => ({
  id: '22222222-2222-4222-8222-222222222222',
  version: 0,
  deletedAt: null,
  code: 'OFFER26',
  discountType: 'PERCENTAGE',
  discountValue: 20,
  validFrom: '2026-10-01T00:00:00.000Z',
  validUntil: '2099-11-01T00:00:00.000Z',
  roomTypeIds: [room.id],
  maxRedemptions: 100,
  currentRedemptions: 5,
  status: 'ACTIVE',
  lifecycleState: 'ACTIVE',
  publicationStatus: 'PENDING',
  currency: 'LKR',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...changes
});
export const page = <T>(items: T[], total = items.length, number = 1) => ({
  items,
  total,
  page: number,
  pageSize: 20
});
