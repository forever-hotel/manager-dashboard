import { z } from 'zod';
export const complaintStatus = z.enum([
  'SUBMITTED',
  'UNDER_REVIEW',
  'RESOLVED',
]);
export const complaintSchema = z.object({
  id: z.uuid(),
  category: z.string(),
  description: z.string(),
  referencedWorkerId: z.uuid().nullable(),
  submittedAt: z.iso.datetime(),
  status: complaintStatus,
  resolvedAt: z.iso.datetime().nullable(),
  version: z.number().int().min(0).max(2147483647),
});
export const complaintDetailSchema = complaintSchema.extend({
  history: z.array(
    z.object({
      version: z.number().int().positive(),
      fromStatus: complaintStatus,
      status: complaintStatus,
      note: z.string(),
      actorId: z.uuid(),
      recordedAt: z.iso.datetime(),
    }),
  ),
});
export const complaintPageSchema = z.object({
  items: z.array(complaintSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(100),
});
export const complaintPatchSchema = z
  .object({
    version: z.number().int().min(0).max(2147483646),
    status: z.enum(['UNDER_REVIEW', 'RESOLVED']),
    note: z
      .string()
      .trim()
      .min(1, 'Enter an internal note.')
      .max(4000, 'Use at most 4000 characters.')
      .regex(/^[\P{Cc}\t\r\n]+$/u, 'Remove control characters.'),
  })
  .strict();
const page = (max: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .refine((s) => Number(s) <= max);
export const complaintQuerySchema = z
  .object({
    page: page(1000000).optional(),
    pageSize: page(100).optional(),
    status: complaintStatus.optional(),
    category: z.string().trim().min(1).max(100).optional(),
    workerId: z.uuid().optional(),
  })
  .strict();
export type Complaint = z.infer<typeof complaintSchema>;
export type ComplaintDetail = z.infer<typeof complaintDetailSchema>;
export const statusLabel = {
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  RESOLVED: 'Resolved',
};
export const COMPLAINT_CHANGED_EVENT = 'mad:complaint-status-changed';
export function nextStatus(status: Complaint['status']) {
  return status === 'SUBMITTED'
    ? 'UNDER_REVIEW'
    : status === 'UNDER_REVIEW'
      ? 'RESOLVED'
      : null;
}
export class ComplaintError extends Error {
  constructor(public status: number) {
    super(
      status === 401
        ? 'Session expired. Sign in again.'
        : status === 403
          ? 'You do not have permission to access complaints.'
          : status === 409
            ? 'Complaint changed. Reload the latest version, review it and save again. Your note is preserved.'
            : status === 400
              ? 'Invalid note or transition. Review the latest complaint before retrying.'
              : status === 404
                ? 'Complaint no longer exists.'
                : 'Service unavailable. Reload before retrying; a save may already have completed.',
    );
  }
}
export async function complaintRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch('/api/complaints' + path, {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) throw new ComplaintError(response.status);
  return schema.parse(await response.json());
}
