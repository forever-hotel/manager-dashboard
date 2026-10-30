export const workerId = '67f4568c-89ab-4c12-b321-123456789012';
const base = {
  period: 'week',
  timezone: 'Asia/Colombo',
  start: '2026-10-18T18:30:00Z',
  end: '2026-10-25T18:30:00Z',
  asOf: '2026-10-21T00:00:00Z',
  freshness: { queriedAt: '2026-10-21T00:00:00Z', sourceLatestUpdatedAt: null }
};
const quality = {
  status: 'OK',
  negativeDurationCount: 0,
  missingCompletionCount: 0,
  unexpectedCompletionCount: 0
};
export const foodFixture = () => ({
  delivery: {
    averageMinutes: null as number | null,
    deliveredCount: 0,
    validDurationCount: 0,
    excludedDurationCount: 0,
    cohort: 'delivered_at_in_period',
    durationStart: 'placed_at'
  },
  revenue: {
    amountMinor: 0,
    currency: 'LKR',
    metric: 'delivered_order_sales',
    recognition: 'delivered_at',
    orderCount: 0
  },
  ...base,
  total: 0,
  trend: [{ date: '2026-10-21', count: 0 }],
  hours: Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 })),
  peakHours: [],
  popularItems: []
});
export const serviceFixture = () => ({
  ...base,
  total: 0,
  trend: [{ date: '2026-10-21', count: 0 }],
  byStatus: ['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'].map(status => ({ status, count: 0 })),
  resolution: {
    completedCount: 0,
    validDurationCount: 0,
    excludedCount: 0,
    averageMinutes: null,
    unit: 'minutes',
    cohort: 'completed_at_in_period'
  },
  backlog: {
    count: 4,
    statuses: ['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS'],
    cohort: 'all_dates'
  },
  dataQuality: { ...quality, scope: 'all_source_records' }
});
export const workerFixture = () => ({
  ...base,
  durationUnit: 'minutes',
  durationStart: 'submitted_at',
  complaintCohort: 'all_open_dates',
  dataQualityScope: 'all_tasks',
  workers: [
    {
      workerId,
      fullName: 'Worker One',
      role: 'WORKER',
      isActive: true,
      completedTaskCount: 0,
      validDurationCount: 0,
      excludedDurationCount: 0,
      averageCompletionMinutes: null,
      openComplaintCount: 2,
      dataQuality: quality
    }
  ]
});
