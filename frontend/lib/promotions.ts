import { z } from 'zod';

const integer = z.number().int().min(1).max(2147483647);
const timestamp = z.iso
  .datetime({ offset: true })
  .regex(
    /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/,
    'Use a valid timestamp with seconds and a timezone offset.'
  );
export const versionSchema = z.object({ version: z.number().int().min(0).max(2147483647) }).strict();
const fields = {
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/)
    .transform(s => s.toUpperCase()),
  discountType: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
  discountValue: integer,
  validFrom: timestamp,
  validUntil: timestamp,
  roomTypeIds: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine(ids => new Set(ids).size === ids.length),
  maxRedemptions: integer
};
function terms(
  value: {
    discountType: string;
    discountValue: number;
    validFrom: string;
    validUntil: string;
  },
  ctx: z.RefinementCtx
) {
  if (value.discountType === 'PERCENTAGE' && value.discountValue > 100)
    ctx.addIssue({
      code: 'custom',
      path: ['discountValue'],
      message: 'Percentage must be between 1 and 100.'
    });
  if (Date.parse(value.validUntil) <= Date.parse(value.validFrom))
    ctx.addIssue({
      code: 'custom',
      path: ['validUntil'],
      message: 'End must be after start.'
    });
}
export const createSchema = z
  .object({ ...fields, status: z.enum(['ACTIVE', 'INACTIVE']).optional() })
  .strict()
  .superRefine(terms);
export const editSchema = z
  .object({ ...fields, version: versionSchema.shape.version })
  .strict()
  .superRefine(terms);
export const promotionSchema = z.object({
  id: z.uuid(),
  version: versionSchema.shape.version,
  deletedAt: z.iso.datetime().nullable(),
  publicationStatus: z.enum(['PENDING', 'FAILED', 'NO_PENDING_WORK']),
  ...fields,
  currency: z.literal('LKR'),
  currentRedemptions: z.number().int().nonnegative(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  lifecycleState: z.enum(['ACTIVE', 'INACTIVE', 'SCHEDULED', 'EXPIRED', 'EXHAUSTED', 'DELETED']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});
export type Promotion = z.infer<typeof promotionSchema>;
export const roomSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  priceMinor: z.number().int(),
  maxGuests: z.number().int()
});
export type RoomType = z.infer<typeof roomSchema>;
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(100)
  });
}
export const publicationLabel = (status: Promotion['publicationStatus']) =>
  ({
    PENDING: 'Publication pending; website availability unconfirmed.',
    FAILED: 'Publication failed; website availability unconfirmed.',
    NO_PENDING_WORK: 'No pending work; website availability unconfirmed.'
  })[status];

export class PromotionError extends Error {
  constructor(public status: number) {
    super(
      status === 401
        ? 'Session expired. Sign in again.'
        : status === 403
          ? 'You do not have permission for this action.'
          : status === 409
            ? 'Conflict: the code may already exist, the version changed, or this action is no longer allowed. Reload the latest version before retrying.'
            : status === 400
              ? 'Invalid promotion. Check the fields, selected rooms and redemption limit.'
              : status === 404
                ? 'Promotion no longer exists. Refresh the list.'
                : 'Service unavailable. Refresh before retrying a save; it may already have succeeded.'
    );
  }
}
export async function promotionRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch('/api/promotions' + path, {
    method,
    signal,
    cache: 'no-store',
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
  });
  if (!response.ok) throw new PromotionError(response.status);
  return schema.parse(await response.json());
}

export type PromotionForm = {
  code: string;
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discountValue: string;
  validFrom: string;
  validUntil: string;
  maxRedemptions: string;
  roomTypeIds: string[];
};
export const emptyForm: PromotionForm = {
  code: '',
  discountType: 'PERCENTAGE',
  discountValue: '',
  validFrom: '',
  validUntil: '',
  maxRedemptions: '',
  roomTypeIds: []
};
// The form always uses hotel time, regardless of the manager's browser timezone.
export function hotelInput(iso: string) {
  return new Date(Date.parse(iso) + 330 * 60000).toISOString().slice(0, -1);
}
export function formFrom(p: Promotion): PromotionForm {
  return {
    code: p.code,
    discountType: p.discountType,
    discountValue: String(p.discountValue),
    validFrom: hotelInput(p.validFrom),
    validUntil: hotelInput(p.validUntil),
    maxRedemptions: String(p.maxRedemptions),
    roomTypeIds: p.roomTypeIds
  };
}
export function formPayload(form: PromotionForm) {
  const date = (s: string) => s + (s.length === 16 ? ':00' : '') + '+05:30';
  return {
    ...form,
    discountValue: Number(form.discountValue),
    maxRedemptions: Number(form.maxRedemptions),
    validFrom: date(form.validFrom),
    validUntil: date(form.validUntil)
  };
}
