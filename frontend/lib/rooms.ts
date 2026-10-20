import { z } from 'zod';

export const roomStatuses = [
  'VACANT',
  'OCCUPIED',
  'REQUIRES_CLEANING',
  'UNDER_MAINTENANCE',
] as const;
export const roomSnapshotSchema = z
  .object({
    rooms: z.array(
      z
        .object({
          id: z.string().min(1).max(10),
          number: z.string().min(1).max(10),
          floor: z.number().int().safe(),
          typeId: z.string().min(1),
          type: z.string().min(1),
          status: z.enum(roomStatuses),
          label: z.string().min(1),
          updatedAt: z.iso.datetime({ offset: true }),
          version: z.number().int().nonnegative().safe(),
        })
        .refine((room) => room.id === room.number),
    ),
    queriedAt: z.iso.datetime({ offset: true }),
    source: z.literal('FDS'),
    readOnly: z.literal(true),
  })
  .refine((s) => new Set(s.rooms.map((r) => r.id)).size === s.rooms.length);
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;
