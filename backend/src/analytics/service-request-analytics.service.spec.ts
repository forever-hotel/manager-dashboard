import { DataSource } from 'typeorm';
import {
  ServiceRequestAnalyticsService,
  ServiceRequestSummaryRow,
  REQUEST_STATUSES
} from './service-request-analytics.service';
import { ServiceRequestAnalyticsController } from './service-request-analytics.controller';
import { SERVICE_REQUESTS_SQL } from './service-requests.sql';

const now = new Date('2026-10-19T06:00:00Z');

function row(): ServiceRequestSummaryRow {
  return {
    period_start: now,
    period_end: now,
    total: '0',
    completed_count: '0',
    valid_duration_count: '0',
    average_minutes: null,
    unresolved_count: '0',
    negative_duration_count: '0',
    missing_completion_count: '0',
    unexpected_completion_count: '0',
    statuses: REQUEST_STATUSES.map(status => ({ status, count: '0' })),
    trend: [{ date: '2026-10-19', count: '0' }],
    source_updated_at: null,
    queried_at: now
  };
}

function setup(data = row()) {
  const query = jest.fn().mockResolvedValue([data]);

  return {
    query,
    service: new ServiceRequestAnalyticsService({ query } as unknown as DataSource, () => now)
  };
}
describe('DDP-024 service-request analytics', () => {
  it('returns explicit cohorts, null average and zero-filled states', async () => {
    const { service, query } = setup();
    const result = await service.summary('day');

    expect(result).toMatchObject({
      total: 0,
      resolution: { averageMinutes: null, completedCount: 0 },
      backlog: { count: 0 },
      dataQuality: { status: 'OK' },
      freshness: { sourceLatestUpdatedAt: null }
    });
    expect(query).toHaveBeenCalledWith(SERVICE_REQUESTS_SQL, [
      'day',
      'Asia/Colombo',
      now.toISOString(),
      now.toISOString()
    ]);
    expect(result.byStatus).toHaveLength(4);
  });
  it('rounds valid minutes and reports corrupt records independently of backlog', async () => {
    const data = {
      ...row(),
      completed_count: '3',
      valid_duration_count: '2',
      average_minutes: '30.55555',
      unresolved_count: '8',
      negative_duration_count: '1',
      source_updated_at: now
    };
    const result = await setup(data).service.summary('week');

    expect(result.resolution).toMatchObject({
      completedCount: 3,
      validDurationCount: 2,
      excludedCount: 1,
      averageMinutes: 30.56
    });
    expect(result.dataQuality.status).toBe('WARNING');
    expect(result.backlog.count).toBe(8);
    expect(result.freshness.sourceLatestUpdatedAt).toBe(now.toISOString());
  });
  it.each(['-1', 'bad', '9007199254740992'])('rejects invalid count %s', async total => {
    await expect(setup({ ...row(), total }).service.summary('day')).rejects.toMatchObject({ status: 503 });
  });
  it('rejects inconsistent buckets and invalid averages', async () => {
    for (const data of [
      { ...row(), trend: [] },
      { ...row(), statuses: [] },
      { ...row(), total: '1' },
      { ...row(), statuses: row().statuses.map(b => ({ ...b, count: '1' })) },
      {
        ...row(),
        statuses: row().statuses.map(b => ({ ...b, status: 'BAD' }))
      },
      { ...row(), valid_duration_count: '1' },
      { ...row(), average_minutes: '0' },
      ...['-1', 'NaN', 'Infinity', '9007199254740992'].map(average_minutes => ({
        ...row(),
        completed_count: '1',
        valid_duration_count: '1',
        average_minutes
      })),
      { ...row(), completed_count: '1', valid_duration_count: '1' }
    ])
      await expect(setup(data).service.summary('month')).rejects.toMatchObject({
        status: 503
      });
  });
  it('preserves genuine zero-minute completions and null when all are invalid', async () => {
    expect(
      (
        await setup({
          ...row(),
          completed_count: '1',
          valid_duration_count: '1',
          average_minutes: '0'
        }).service.summary('day')
      ).resolution.averageMinutes
    ).toBe(0);
    expect(
      (
        await setup({
          ...row(),
          completed_count: '1',
          negative_duration_count: '1'
        }).service.summary('day')
      ).resolution.averageMinutes
    ).toBeNull();
  });
  it('sanitizes missing or failed source results and forwards controller periods', async () => {
    const { service, query } = setup();

    expect(
      (
        await new ServiceRequestAnalyticsController(service).summary({
          period: 'month'
        })
      ).period
    ).toBe('month');
    query.mockResolvedValueOnce([]);
    await expect(service.summary('day')).rejects.toMatchObject({ status: 503 });
    query.mockRejectedValue(new Error('private SQL'));
    await expect(service.summary('day')).rejects.toMatchObject({
      status: 503,
      message: 'Service Unavailable'
    });
  });
});
