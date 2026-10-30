import { roomStatuses } from '@/lib/rooms';

export const roomsSnapshot = () => ({
  rooms: roomStatuses.map((status, index) => ({
    id: String(101 + index),
    number: String(101 + index),
    floor: index === 3 ? 0 : 2,
    typeId: 'type-id',
    type: 'Deluxe',
    status,
    label: String(status),
    updatedAt: '2026-10-20T00:00:00Z',
    version: 1
  })),
  queriedAt: '2026-10-20T00:00:00Z',
  source: 'FDS' as const,
  readOnly: true as const
});
