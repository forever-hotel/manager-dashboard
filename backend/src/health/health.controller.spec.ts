import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

describe('Readiness dependencies', () => {
  const query = jest.fn();
  const controller = new HealthController({ query } as unknown as DataSource);
  let log: jest.SpyInstance;
  beforeEach(() => {
    query.mockReset().mockResolvedValue([]);
    log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('requires both schema-qualified auth dependencies', async () => {
    await expect(controller.ready()).resolves.toMatchObject({
      database: 'ready',
    });
    expect(query).toHaveBeenNthCalledWith(
      1,
      'SELECT token_hash FROM public.mad_revoked_sessions LIMIT 0',
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM public.staff_users LIMIT 0'),
    );
    expect(log).not.toHaveBeenCalled();
  });

  it.each(['42P01', '42501', '42703'])(
    'fails closed with safe diagnostics for %s',
    async (code) => {
      query.mockRejectedValueOnce({
        driverError: { code, message: 'private connection secret' },
      });
      await expect(controller.ready()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(log).toHaveBeenCalledWith({
        event: 'readiness_dependency_failed',
        dependency: 'public.mad_revoked_sessions',
        postgresCode: code,
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain('private');
      expect(controller.live()).toMatchObject({ status: 'ok' });
    },
  );

  it('identifies a failing staff schema separately', async () => {
    query.mockResolvedValueOnce([]).mockRejectedValueOnce({ code: '42703' });
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        dependency: 'public.staff_users',
        postgresCode: '42703',
      }),
    );
  });

  it('does not log arbitrary error codes or messages', async () => {
    query.mockRejectedValueOnce({
      code: 'secret-url',
      message: 'private password',
    });
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ postgresCode: 'unknown' }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /secret-url|private password/,
    );
  });
});
