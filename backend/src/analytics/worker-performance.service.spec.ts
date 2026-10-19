import { DataSource } from 'typeorm';
import { WorkerPerformanceController } from './worker-performance.controller';
import {
  WorkerPerformanceRow,
  WorkerPerformanceService,
} from './worker-performance.service';
import { WORKER_PERFORMANCE_SQL } from './worker-performance.sql';

const now = new Date('2026-10-19T06:00:00Z');
function worker(): WorkerPerformanceRow['workers'][number] {
  return {
    workerId: '0b26eaf5-74c4-4c8b-86ca-4340cd245665',
    fullName: 'Worker',
    role: 'WORKER',
    isActive: false,
    completedCount: '0',
    validDurationCount: '0',
    averageMinutes: null,
    openComplaintCount: '0',
    negativeDurationCount: '0',
    missingCompletionCount: '0',
    unexpectedCompletionCount: '0',
  };
}
function row(): WorkerPerformanceRow {
  return {
    period_start: now,
    period_end: now,
    queried_at: now,
    source_updated_at: null,
    workers: [worker()],
  };
}
function setup(data = row()) {
  const query = jest.fn().mockResolvedValue([data]);
  return {
    query,
    service: new WorkerPerformanceService(
      { query } as unknown as DataSource,
      () => now,
    ),
  };
}
describe('DDP-025 worker performance', () => {
  it('Given a worker without activity, returns zero counts and a null average with explicit cohorts', async () => {
    const { service, query } = setup();
    const result = await service.summary({ period: 'day' });
    expect(result).toMatchObject({
      durationStart: 'submitted_at',
      durationUnit: 'minutes',
      freshness: { sourceLatestUpdatedAt: null },
      workers: [
        {
          isActive: false,
          completedTaskCount: 0,
          averageCompletionMinutes: null,
          openComplaintCount: 0,
          dataQuality: { status: 'OK' },
        },
      ],
    });
    expect(query).toHaveBeenCalledWith(WORKER_PERFORMANCE_SQL, [
      'day',
      'Asia/Colombo',
      now.toISOString(),
      null,
    ]);
  });
  it('Given independent aggregates, maps rounded durations and flags exclusions', async () => {
    const data = {
      ...row(),
      source_updated_at: now,
      workers: [
        {
          ...worker(),
          completedCount: '3',
          validDurationCount: '2',
          averageMinutes: '30.55555',
          openComplaintCount: '4',
          negativeDurationCount: '1',
        },
      ],
    };
    const { service, query } = setup(data);
    const result = await new WorkerPerformanceController(service).summary({
      period: 'week',
      workerId: worker().workerId,
    });
    expect(query).toHaveBeenCalledWith(WORKER_PERFORMANCE_SQL, [
      'week',
      'Asia/Colombo',
      now.toISOString(),
      worker().workerId,
    ]);
    expect(result.workers[0]).toMatchObject({
      completedTaskCount: 3,
      validDurationCount: 2,
      excludedDurationCount: 1,
      averageCompletionMinutes: 30.56,
      openComplaintCount: 4,
      dataQuality: { status: 'WARNING' },
    });
    expect(result.freshness.sourceLatestUpdatedAt).toBe(now.toISOString());
  });
  it('Given zero duration or exclusively invalid completions, distinguishes zero from null', async () => {
    const data = row();
    data.workers = [
      {
        ...worker(),
        completedCount: '1',
        validDurationCount: '1',
        averageMinutes: '0',
      },
      { ...worker(), completedCount: '1', negativeDurationCount: '1' },
    ];
    const result = await setup(data).service.summary({ period: 'month' });
    expect(result.workers.map((w) => w.averageCompletionMinutes)).toEqual([
      0,
      null,
    ]);
    expect(
      (
        await setup({ ...row(), workers: [] }).service.summary({
          period: 'day',
        })
      ).workers,
    ).toEqual([]);
  });
  it.each(['-1', 'invalid', '9007199254740992'])(
    'Given unsafe count %s, rejects instead of publishing it',
    async (completedCount) => {
      await expect(
        setup({
          ...row(),
          workers: [{ ...worker(), completedCount }],
        }).service.summary({ period: 'day' }),
      ).rejects.toMatchObject({ status: 503 });
    },
  );
  it('Given inconsistent duration aggregates, returns a safe error', async () => {
    for (const patch of [
      { validDurationCount: '1' },
      { averageMinutes: '0' },
      { completedCount: '1', validDurationCount: '1' },
      ...['-1', 'NaN', 'Infinity', '9007199254740992'].map(
        (averageMinutes) => ({
          completedCount: '1',
          validDurationCount: '1',
          averageMinutes,
        }),
      ),
    ]) {
      await expect(
        setup({
          ...row(),
          workers: [{ ...worker(), ...patch }],
        }).service.summary({ period: 'day' }),
      ).rejects.toMatchObject({ status: 503 });
    }
  });
  it('Given missing results or database failure, never fabricates an empty report or leaks SQL', async () => {
    const { service, query } = setup();
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...row(), workers: null }])
      .mockRejectedValueOnce(new Error('private SQL'));
    for (let i = 0; i < 3; i++)
      await expect(service.summary({ period: 'day' })).rejects.toMatchObject({
        status: 503,
        message: 'Service Unavailable',
      });
  });
});
