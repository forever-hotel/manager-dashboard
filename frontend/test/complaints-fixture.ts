import type { ComplaintDetail } from '@/lib/complaints';
export const complaint = (changes: Partial<ComplaintDetail> = {}): ComplaintDetail => ({
  id: '11111111-1111-4111-8111-111111111111',
  category: 'Room',
  description: 'The room needs attention.',
  referencedWorkerId: null,
  submittedAt: '2026-10-16T00:00:00.000Z',
  resolvedAt: null,
  status: 'SUBMITTED',
  version: 0,
  history: [],
  ...changes
});
export const complaintPage = (items = [complaint()], total = items.length) => ({
  items,
  total,
  page: 1,
  pageSize: 20
});
