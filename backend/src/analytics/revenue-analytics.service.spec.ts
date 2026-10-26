import { DataSource } from 'typeorm';
import { RevenueAnalyticsService } from './revenue-analytics.service';
const now = () => new Date('2026-10-15T00:00:00Z');
const row = {
  start: new Date('2026-10-14T18:30:00Z'),
  finish: new Date('2026-10-15T18:30:00Z'),
  previous_start: new Date('2026-10-13T18:30:00Z'),
  current: '20001',
  previous: '10000',
  percentage: '100.01',
  invalid: '0'
};
function setup(rows: unknown[] = [row]) {
  const query = jest.fn().mockResolvedValue(rows);
  return {
    query,
    service: new RevenueAnalyticsService({ query } as unknown as DataSource, now)
  };
}
describe('DDP-056 revenue contract', () => {
  it('returns integer LKR cents and database-rounded percentage with shared timestamp', async () => {
    const { query, service } = setup();
    const asOf = '2026-10-15T01:00:00.000Z';
    expect(await service.summary('day', asOf)).toMatchObject({
      currentMinor: 20001,
      previousMinor: 10000,
      percentageChange: 100.01,
      percentageUnavailableReason: null,
      asOf,
      currency: 'LKR'
    });
    expect(query).toHaveBeenCalledWith(expect.any(String), ['day', 'Asia/Colombo', asOf]);
  });
  it('returns null and reason for zero previous revenue', async () => {
    expect(await setup([{ ...row, previous: '0', percentage: null }]).service.summary('day')).toMatchObject({
      percentageChange: null,
      percentageUnavailableReason: 'PREVIOUS_REVENUE_ZERO'
    });
  });
  it.each(
    [
      [],
      [undefined],
      [row, row],
      [{ ...row, invalid: '1' }],
      [{ ...row, invalid: 'NaN' }],
      [{ ...row, current: '' }],
      [{ ...row, previous: ' ' }],
      [{ ...row, current: '1.5' }],
      [{ ...row, current: '9007199254740992' }],
      [{ ...row, previous: '9007199254740992' }],
      [{ ...row, current: '-1' }],
      [{ ...row, percentage: 'NaN' }],
      [{ ...row, percentage: '' }],
      [{ ...row, percentage: '9'.repeat(400) }],
      [{ ...row, percentage: null }],
      [{ ...row, previous: '0', percentage: '0' }]
    ].map(rows => ({ rows }))
  )('fails closed for invalid source aggregates %j', async ({ rows }) => {
    await expect(setup(rows).service.summary('day')).rejects.toMatchObject({
      status: 503
    });
  });
  it('sanitizes database errors', async () => {
    const { service, query } = setup();
    query.mockRejectedValue(new Error('private database detail'));
    await expect(service.summary('day')).rejects.toMatchObject({ status: 503 });
  });
  it('TC-MAD-056-AC1: preserves zero current revenue as a real 100 percent decline', async () => {
    expect(await setup([{ ...row, current: '0', percentage: '-100.00' }]).service.summary('day')).toMatchObject({
      currentMinor: 0,
      previousMinor: 10000,
      percentageChange: -100,
      percentageUnavailableReason: null
    });
  });
  it('uses the same selected historical period while retaining query freshness', async () => {
    const { query, service } = setup();
    const result = await service.summary('month', undefined, '2026-08-01');
    expect(query).toHaveBeenCalledWith(expect.any(String), ['month', 'Asia/Colombo', '2026-08-01T12:00:00.000Z']);
    expect(result.asOf).toBe(now().toISOString());
  });
});
