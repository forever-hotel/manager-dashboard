export const taskLimitFixture = () => ({
  limit: 3,
  version: 0,
  updatedAt: '2026-10-21T00:00:00Z',
  effectiveLimit: null as number | null,
  effectiveVersion: null as number | null,
  confirmedAt: null as string | null,
  status: 'PENDING' as 'PENDING' | 'EFFECTIVE',
  defaultLimit: 3,
  minLimit: 1,
  maxLimit: 10,
  activeStates: ['ASSIGNED', 'IN_PROGRESS', 'ESCALATED'],
  assignedWorkerRequired: true,
});
