import { z } from 'zod';
export const taskStatuses = ['UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'ESCALATED'] as const;
export const taskLabels = {
  UNASSIGNED: 'Unassigned',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  ESCALATED: 'Escalated'
};
export const tasksSnapshotSchema = z
  .object({
    tasks: z
      .array(
        z
          .object({
            id: z.uuid(),
            roomNumber: z.string().min(1).max(10),
            category: z.enum([
              'ROOM_CLEANING',
              'EXTRA_TOWELS',
              'WATER_BOTTLES',
              'MAINTENANCE',
              'LAUNDRY',
              'FOOD_DELIVERY',
              'OTHER'
            ]),
            priority: z.enum(['HIGH', 'NORMAL']),
            status: z.enum(taskStatuses),
            assignee: z.object({ id: z.uuid(), name: z.string() }).nullable(),
            submittedAt: z.iso.datetime({ offset: true }),
            updatedAt: z.iso.datetime({ offset: true }),
            completedAt: z.iso.datetime({ offset: true }).nullable(),
            version: z.number().int().nonnegative().safe()
          })
          .refine(t => (t.status === 'COMPLETED') === (t.completedAt !== null))
      )
      .max(100),
    total: z.number().int().nonnegative().safe(),
    queriedAt: z.iso.datetime({ offset: true }),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(100),
    source: z.literal('WKMS'),
    readOnly: z.literal(true)
  })
  .refine(s => new Set(s.tasks.map(t => t.id)).size === s.tasks.length);
