import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';
describe('Health and readiness', () => {
  it('keeps liveness independent from database availability', async () => {
    const query = jest
      .fn()
      .mockRejectedValue(new Error('private database details'));
    const controller = new HealthController({ query } as unknown as DataSource);
    expect(controller.live()).toEqual({ status: 'ok', service: 'mad-backend' });
    await expect(controller.ready()).rejects.toThrow('Service Unavailable');
  });
  it('reports readiness only after reaching the migrated database', async () => {
    const controller = new HealthController({
      query: jest.fn().mockResolvedValue([]),
    } as unknown as DataSource);
    expect((await controller.ready()).database).toBe('ready');
  });
});
