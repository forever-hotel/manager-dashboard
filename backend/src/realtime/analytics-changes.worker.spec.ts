import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AnalyticsChangesWorker } from './analytics-changes.worker';
import { RealtimeGateway } from './realtime.gateway';
describe('read-only analytics change reconciliation', () => {
  it('invalidates only changed families and does not advance a failed publication', async () => {
    const row = { bookings: 'b', payments: 'p', food: 'f', items: 'i' };
    const query = jest.fn().mockResolvedValue([row]);
    const send = jest.fn().mockResolvedValue(undefined);
    const gateway = { send, analyticsHealthy: false };
    const worker = new AnalyticsChangesWorker(
      { query } as unknown as DataSource,
      gateway as unknown as RealtimeGateway,
      new ConfigService()
    );
    await worker.tick();
    expect(send).toHaveBeenCalledTimes(2);
    send.mockClear();
    await worker.tick();
    expect(send).not.toHaveBeenCalled();
    query.mockResolvedValue([{ ...row, payments: 'new' }]);
    send.mockRejectedValueOnce(new Error('broker offline'));
    await worker.tick();
    expect(gateway.analyticsHealthy).toBe(false);
    await worker.tick();
    expect(send).toHaveBeenLastCalledWith('analytics.changed', {});
    expect(gateway.analyticsHealthy).toBe(true);
    send.mockClear();
    query.mockResolvedValue([{ ...row, payments: 'new', items: 'new' }]);
    await worker.tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('food.analytics.changed', {});
    await worker.onModuleDestroy();
  });
});
