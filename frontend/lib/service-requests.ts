import { z } from 'zod';

export const serviceRequestListSchema = z
  .object({
    requests: z
      .array(
        z.object({
          id: z.uuid(),
          roomNumber: z.string().min(1).max(10),
          category: z.string().min(1).max(100),
          status: z.enum(['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED']),
          submittedAt: z.iso.datetime({ offset: true }),
          assignee: z.string().min(1).max(255).nullable()
        })
      )
      .max(50),
    total: z.number().int().nonnegative().safe(),
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(50),
    view: z.enum(['active', 'all'])
  })
  .refine(
    value =>
      value.requests.length ===
        Math.min(value.pageSize, Math.max(0, value.total - (value.page - 1) * value.pageSize)) &&
      new Set(value.requests.map(item => item.id)).size === value.requests.length &&
      (value.view !== 'active' || value.requests.every(item => item.status !== 'COMPLETED'))
  );
