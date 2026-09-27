import { DataSource } from 'typeorm';
import { MadFoundation1789600000000 } from './migrations/001-foundation';

export async function migrate(database: DataSource, role: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role))
    throw new Error('MAD_DB_ROLE must be a simple PostgreSQL identifier');
  const runner = database.createQueryRunner();
  let transactionStarted = false;
  try {
    await runner.connect();
    await runner.startTransaction();
    transactionStarted = true;
    await runner.query('SELECT pg_advisory_xact_lock(1789600000)');
    // An inherited/owner/superuser role cannot be restricted by table REVOKEs.
    // Fail without changing another service's PUBLIC grants or role membership.
    await runner.query(`DO $$
      DECLARE principal oid;
      BEGIN
        SELECT oid INTO principal FROM pg_roles
          WHERE rolname = '${role}' AND rolcanlogin
            AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
            AND NOT rolreplication AND NOT rolbypassrls;
        IF principal IS NULL
          OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = principal)
          OR EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database() AND datdba = principal)
          OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = principal)
          OR EXISTS (SELECT 1 FROM pg_class WHERE relowner = principal)
        THEN
          RAISE EXCEPTION 'MAD_DB_ROLE must be a dedicated non-owner login without privileged flags or role memberships';
        END IF;
      END $$`);
    await runner.query(
      'CREATE TABLE IF NOT EXISTS mad_migrations (version bigint PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    // Append future forward migrations here; never replay recorded versions.
    const migrations = [
      { version: '1789600000000', migration: new MadFoundation1789600000000() },
    ];
    for (const { version, migration } of migrations) {
      const applied = (await runner.query(
        'SELECT version FROM mad_migrations WHERE version = $1',
        [version],
      )) as { version: string }[];
      if (!applied.length) {
        await migration.up(runner);
        await runner.query('INSERT INTO mad_migrations(version) VALUES ($1)', [
          version,
        ]);
      }
    }
    // Never grant ownership, schema creation or shared-service writes to the runtime principal.
    await runner.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      REVOKE ALL ON SCHEMA public FROM "${role}";
      GRANT USAGE ON SCHEMA public TO "${role}";
      REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${role}";
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "${role}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON mad_promotion_codes, mad_revoked_sessions TO "${role}";`);
    for (const table of [
      'bookings',
      'payments',
      'rooms',
      'room_types',
      'mad_booking_analytics',
    ]) {
      const found = (await runner.query(
        'SELECT to_regclass($1)::text AS present',
        ['public.' + table],
      )) as { present: string | null }[];
      if (found[0].present)
        await runner.query(`GRANT SELECT ON "${table}" TO "${role}"`);
    }
    await runner.query(`DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'f')
          AND c.relname NOT IN ('mad_promotion_codes', 'mad_revoked_sessions')
          AND (has_table_privilege('${role}', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR has_any_column_privilege('${role}', c.oid, 'INSERT,UPDATE,REFERENCES'))
      ) THEN
        RAISE EXCEPTION 'Shared-table grants permit runtime writes; the database owner must restrict those grants before migration';
      END IF;
    END $$`);
    await runner.commitTransaction();
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
}
