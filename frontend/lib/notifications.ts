import { z } from 'zod';
export const notificationItemSchema = z
  .object({
    id: z.string(),
    type: z.enum(['COMPLAINT', 'STOCK']),
    sourceId: z.uuid(),
    title: z.string().trim().min(1).max(265),
    status: z.enum([
      'SUBMITTED',
      'UNDER_REVIEW',
      'LOW_STOCK',
      'UNAVAILABLE',
      'TEMPORARILY_DISABLED',
    ]),
    occurredAt: z.iso.datetime({ offset: true }),
    revision: z.string().regex(/^[A-Z0-9:_-]{1,100}$/),
    isRead: z.boolean(),
    href: z.string(),
  })
  .refine(
    (item) =>
      item.id === item.type + ':' + item.sourceId &&
      (item.type === 'COMPLAINT'
        ? ['SUBMITTED', 'UNDER_REVIEW'].includes(item.status) &&
          item.href === '/complaints?complaintId=' + item.sourceId
        : ['LOW_STOCK', 'UNAVAILABLE', 'TEMPORARILY_DISABLED'].includes(
            item.status,
          ) &&
          /^\/notifications\?page=\d+#stock-/.test(item.href) &&
          item.href.endsWith('#stock-' + item.sourceId)),
  );
export const notificationsSchema = z
  .object({
    items: z.array(notificationItemSchema).max(100),
    total: z.number().int().nonnegative().safe(),
    unread: z.number().int().nonnegative().safe(),
    counts: z.object({
      complaints: z.number().int().nonnegative().safe(),
      stock: z.number().int().nonnegative().safe(),
    }),
    page: z.number().int().min(1).max(100000),
    pageSize: z.number().int().min(1).max(100),
    queriedAt: z.iso.datetime({ offset: true }),
  })
  .refine(
    (s) =>
      s.total === s.counts.complaints + s.counts.stock &&
      s.unread <= s.total &&
      s.items.length ===
        Math.min(
          s.pageSize,
          Math.max(0, s.total - (s.page - 1) * s.pageSize),
        ) &&
      new Set(s.items.map((i) => i.id.toLowerCase())).size === s.items.length &&
      s.items.every(
        (i) =>
          i.type !== 'STOCK' ||
          i.href === '/notifications?page=' + s.page + '#stock-' + i.sourceId,
      ),
  );
export const readNotificationSchema = z
  .object({ revision: z.string().regex(/^[A-Z0-9:_-]{1,100}$/) })
  .strict();
export type NotificationItem = z.infer<typeof notificationItemSchema>;
