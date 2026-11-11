export const REALTIME_EXCHANGE = 'hotel.realtime';
export const channels = ['analytics', 'kitchen', 'rooms', 'tasks', 'stock', 'notifications'] as const;
export type LiveChannel = (typeof channels)[number];
export const eventChannels: Record<string, LiveChannel> = {
  'analytics.changed': 'analytics',
  'analytics.transport.status': 'analytics',
  'food.analytics.changed': 'kitchen',
  'kitchen.order.changed': 'kitchen',
  'transport.status': 'kitchen',
  'room.status.changed': 'rooms',
  'rooms.transport.status': 'rooms',
  'task.changed': 'tasks',
  'tasks.transport.status': 'tasks',
  'stock.alert.changed': 'stock',
  'stock.transport.status': 'stock',
  'notifications.changed': 'notifications',
  'notifications.transport.status': 'notifications'
};
