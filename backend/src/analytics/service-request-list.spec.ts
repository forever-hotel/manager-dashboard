import { DataSource } from 'typeorm';
import { ServiceRequestAnalyticsService } from './service-request-analytics.service';
import { ServiceRequestListQueryDto } from './service-request-query.dto';
import { SERVICE_REQUEST_LIST_SQL } from './service-request-list.sql';
const now = new Date('2026-10-27T00:00:00Z');
const item = {
  id: '67f4568c-89ab-4c12-b321-123456789012',
  roomNumber: '204',
  category: 'ROOM_CLEANING',
  status: 'ASSIGNED',
  submittedAt: '2026-10-20T00:00:00Z',
  assignee: 'Worker One'
};
function setup(row: unknown = { total: '1', requests: [item] }) {
  const query = jest.fn<Promise<unknown[]>, [string, unknown[]]>().mockResolvedValue([row]);
  return { query, service: new ServiceRequestAnalyticsService({ query } as unknown as DataSource, () => now) };
}
describe('service request active list and history', () => {
  it('binds active scope, real clock and stable paging', async () => {
    const { query, service } = setup();
    expect(await service.list(new ServiceRequestListQueryDto())).toMatchObject({
      total: 1,
      requests: [item],
      view: 'all',
      page: 1
    });
    expect(query).toHaveBeenCalledWith(SERVICE_REQUEST_LIST_SQL, [
      'day',
      'Asia/Colombo',
      now.toISOString(),
      'all',
      20,
      0
    ]);
  });
  it('supports historical completed requests and empty later pages', async () => {
    const { query, service } = setup({ total: '1', requests: [{ ...item, status: 'COMPLETED', assignee: null }] });
    await expect(
      service.list({ ...new ServiceRequestListQueryDto(), view: 'all', period: 'month', date: '2026-09-01' })
    ).resolves.toMatchObject({ view: 'all' });
    expect(query.mock.calls[0][1][2]).toBe('2026-09-01T12:00:00.000Z');
    query.mockResolvedValueOnce([{ total: '1', requests: [] }]);
    await expect(service.list({ ...new ServiceRequestListQueryDto(), page: 2 })).resolves.toMatchObject({
      page: 2,
      total: 1
    });
  });
  it.each([
    { total: '-1', requests: [] },
    { total: '2', requests: [item] },
    { total: '1', requests: [{ ...item, status: 'COMPLETED' }] },
    { total: '1', requests: [{ ...item, id: 'invalid' }] },
    { total: '1', requests: [{ ...item, submittedAt: 'invalid' }] },
    { total: '1', requests: [{ ...item, assignee: '' }] },
    { total: '2', requests: [item, item] }
  ])('rejects malformed source rows', async row => {
    await expect(
      setup(row).service.list({ ...new ServiceRequestListQueryDto(), view: 'active' })
    ).rejects.toMatchObject({ status: 503 });
  });
  it('keeps history bounds separate from the current backlog clock', async () => {
    const { query, service } = setup();
    query.mockResolvedValueOnce([]);
    await expect(service.summary('month', '2026-09-01')).rejects.toMatchObject({ status: 503 });
    expect(query.mock.calls[0][1]).toEqual(['month', 'Asia/Colombo', '2026-09-01T12:00:00.000Z', now.toISOString()]);
  });
});
