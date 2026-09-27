import { DataSource } from 'typeorm';
import { migrate } from './migrate';
import { MadFoundation1789600000000 } from './migrations/001-foundation';
describe('Migration transaction handling', () => {
  function setup(applied = false) {
    const query = jest.fn((sql: string) =>
      Promise.resolve(
        sql.startsWith('SELECT version')
          ? applied
            ? [{ version: '1789600000000' }]
            : []
          : sql.startsWith('SELECT to_regclass')
            ? [{ present: 'bookings' }]
            : [],
      ),
    );
    const runner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      query,
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
    };
    return {
      runner,
      database: { createQueryRunner: () => runner } as unknown as DataSource,
    };
  }
  it('records migrations and always releases its connection', async () => {
    const { runner, database } = setup();
    await migrate(database, 'mad_app');
    expect(runner.commitTransaction).toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
    expect(runner.query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  });
  it('does not reapply a recorded version', async () => {
    const { runner, database } = setup(true);
    await migrate(database, 'mad_app');
    expect(
      runner.query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO mad_migrations'),
      ),
    ).toBe(false);
  });
  it('rolls back and releases on migration failure', async () => {
    const { runner, database } = setup();
    runner.query.mockRejectedValueOnce(new Error('database failure'));
    await expect(migrate(database, 'mad_app')).rejects.toThrow(
      'database failure',
    );
    expect(runner.rollbackTransaction).toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });
  it('refuses injected role identifiers before connecting', async () => {
    const { runner, database } = setup();
    await expect(
      migrate(database, 'mad_app; DROP TABLE bookings'),
    ).rejects.toThrow('MAD_DB_ROLE');
    expect(runner.connect).not.toHaveBeenCalled();
  });
  it('refuses destructive rollback', async () => {
    await expect(new MadFoundation1789600000000().down()).rejects.toThrow(
      'rollback',
    );
  });
});
