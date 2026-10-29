import { z } from 'zod';
export const staffRoles = ['RECEPTIONIST', 'WORKER', 'KITCHEN_STAFF', 'KITCHEN_MANAGER'] as const;
export const staffLabels = {
  RECEPTIONIST: 'Receptionist',
  WORKER: 'Worker',
  KITCHEN_STAFF: 'Kitchen Staff',
  KITCHEN_MANAGER: 'Kitchen Manager'
};
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}<>]+$/u);
export const staffInput = z
  .object({
    name: text(255),
    vocation: text(100),
    email: z.email().max(320),
    age: z.number().int().min(1).max(120),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9]{7,15}$/),
    nic: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^(?:[0-9]{9}[VX]|[0-9]{12})$/),
    role: z.enum(staffRoles)
  })
  .strict();
export const staffPatch = staffInput
  .partial()
  .extend({
    version: z.number().int().min(0).max(2147483646),
    isActive: z.boolean().optional()
  })
  .strict()
  .refine(v => Object.keys(v).length > 1);
export const staffProfile = z.object({
  staffId: z.uuid(),
  name: z.string(),
  vocation: z.string(),
  email: z.string(),
  age: z.number().nullable(),
  phone: z.string().nullable(),
  nic: z.string().nullable(),
  username: z.string(),
  role: z.enum(staffRoles),
  isActive: z.boolean(),
  passwordChangeRequired: z.boolean(),
  version: z.number().int().nonnegative()
});
const directoryText = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[^\p{Cc}]*$/u)
    .refine(value => Boolean(value.trim()));
export const staffDetail = staffProfile.extend({
  name: directoryText(255),
  vocation: directoryText(100),
  email: directoryText(320),
  username: directoryText(100),
  age: z.number().int().min(1).max(120).nullable(),
  phone: z
    .string()
    .max(20)
    .regex(/^[^\p{Cc}]*$/u)
    .nullable(),
  nic: z
    .string()
    .max(50)
    .regex(/^[^\p{Cc}]*$/u)
    .nullable(),
  version: z.number().int().nonnegative().max(2147483647),
  deliveryStatus: z.enum(['pending', 'sent', 'failed', 'cancelled', 'none'])
});
export const staffPage = z
  .object({
    items: z.array(staffDetail).max(100),
    total: z.number().int().nonnegative().safe(),
    page: z.number().int().positive().max(100000),
    pageSize: z.number().int().positive().max(100)
  })
  .refine(
    data =>
      data.items.length === Math.min(data.pageSize, Math.max(0, data.total - (data.page - 1) * data.pageSize)) &&
      new Set(data.items.map(item => item.staffId.toLowerCase())).size === data.items.length
  );
export const staffReceipt = z.object({
  staffId: z.uuid(),
  deliveryId: z.uuid(),
  deliveryStatus: z.literal('pending')
});
export const staffQuery = z
  .object({
    search: z
      .string()
      .trim()
      .max(100)
      .regex(/^[^\p{Cc}]*$/u)
      .optional(),
    role: z.enum(staffRoles).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    page: z
      .string()
      .regex(/^\d+$/)
      .refine(v => Number(v) >= 1 && Number(v) <= 100000)
      .default('1'),
    pageSize: z
      .string()
      .regex(/^\d+$/)
      .refine(v => Number(v) >= 1 && Number(v) <= 100)
      .default('20')
  })
  .strict();
export type Staff = z.infer<typeof staffDetail>;
