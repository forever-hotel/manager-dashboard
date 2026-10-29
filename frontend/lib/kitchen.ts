import { z } from 'zod';
export const kitchenStatuses = ['PLACED', 'IN_PREPARATION', 'READY', 'DELIVERED'] as const;
export const kitchenOrderSchema = z.object({
  id: z.uuid(),
  roomNumber: z.string().max(10),
  mealPeriod: z.string().max(40),
  status: z.enum(kitchenStatuses),
  placedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  version: z.number().int().nonnegative().safe(),
  itemCount: z.number().int().nonnegative().safe()
});
export const kitchenSnapshotSchema = z
  .object({
    orders: z.array(kitchenOrderSchema).max(100),
    counts: z.object({
      PLACED: z.number().int().nonnegative().safe(),
      IN_PREPARATION: z.number().int().nonnegative().safe(),
      READY: z.number().int().nonnegative().safe(),
      DELIVERED: z.number().int().nonnegative().safe()
    }),
    total: z.number().int().nonnegative().safe(),
    asOf: z.iso.datetime({ offset: true }),
    deliveredSince: z.iso.datetime({ offset: true }),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(100)
  })
  .refine(s => new Set(s.orders.map(o => o.id)).size === s.orders.length);
export type KitchenSnapshot = z.infer<typeof kitchenSnapshotSchema>;
export type KitchenStatus = (typeof kitchenStatuses)[number];
export const kitchenLabels: Record<KitchenStatus, string> = {
  PLACED: 'Pending',
  IN_PREPARATION: 'In Preparation',
  READY: 'Ready for Delivery',
  DELIVERED: 'Delivered today'
};
