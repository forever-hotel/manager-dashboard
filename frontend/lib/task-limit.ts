import { z } from 'zod';
export const taskLimitInput = z
  .object({
    limit: z.number().int().min(1).max(10),
    version: z.number().int().min(0).max(2147483646)
  })
  .strict();
const revision = z.number().int().min(0).max(2147483647);
export const taskLimitSchema = z
  .object({
    limit: z.number().int().min(1).max(10),
    version: revision,
    updatedAt: z.iso.datetime({ offset: true }),
    effectiveLimit: z.number().int().min(1).max(10).nullable(),
    effectiveVersion: revision.nullable(),
    confirmedAt: z.iso.datetime({ offset: true }).nullable(),
    status: z.enum(['PENDING', 'EFFECTIVE']),
    defaultLimit: z.literal(3),
    minLimit: z.literal(1),
    maxLimit: z.literal(10),
    activeStates: z.tuple([z.literal('ASSIGNED'), z.literal('IN_PROGRESS'), z.literal('ESCALATED')]),
    assignedWorkerRequired: z.literal(true)
  })
  .refine(p =>
    p.effectiveVersion === null
      ? p.effectiveLimit === null && p.confirmedAt === null && p.status === 'PENDING'
      : p.effectiveLimit !== null &&
        p.confirmedAt !== null &&
        p.effectiveVersion <= p.version &&
        (p.effectiveVersion === p.version
          ? p.status === 'EFFECTIVE' && p.effectiveLimit === p.limit
          : p.status === 'PENDING')
  );
export type TaskLimit = z.infer<typeof taskLimitSchema>;
