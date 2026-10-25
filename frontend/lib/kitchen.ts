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
export const kitchenEventSchema = z.object({
  eventId: z.uuid(),
  type: z.literal('kitchen.order.changed'),
  orderId: z.uuid(),
  version: z.number().int().nonnegative().safe(),
  occurredAt: z.iso.datetime({ offset: true })
});
export type KitchenSnapshot = z.infer<typeof kitchenSnapshotSchema>;
export type KitchenEvent = z.infer<typeof kitchenEventSchema>;
export type KitchenStatus = (typeof kitchenStatuses)[number];
export const kitchenLabels: Record<KitchenStatus, string> = {
  PLACED: 'Pending',
  IN_PREPARATION: 'In Preparation',
  READY: 'Ready for Delivery',
  DELIVERED: 'Delivered'
};

// Bounded deduplication; source snapshots remain authoritative even after eviction.
export class KitchenVersions {
  private readonly versions = new Map<string, number>();
  accept(event: KitchenEvent) {
    const previous = this.versions.get(event.orderId);
    if (previous !== undefined && previous >= event.version) return false;
    this.versions.delete(event.orderId);
    this.versions.set(event.orderId, event.version);
    if (this.versions.size > 2000) this.versions.delete(this.versions.keys().next().value!);
    return true;
  }
}
