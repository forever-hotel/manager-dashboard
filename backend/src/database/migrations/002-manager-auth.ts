import { MigrationInterface, QueryRunner } from 'typeorm';

export class MadManagerAuth1790726400000 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(`
      CREATE TABLE mad_manager_accounts (
        manager_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username varchar(100) NOT NULL UNIQUE,
        password_hash text NOT NULL,
        active boolean NOT NULL DEFAULT true,
        password_change_required boolean NOT NULL DEFAULT true,
        session_version integer NOT NULL DEFAULT 0 CHECK (session_version >= 0),
        failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
        locked_until timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (username = lower(trim(username)) AND length(username) > 0)
      );
      REVOKE ALL ON mad_manager_accounts FROM PUBLIC;
    `);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Destructive rollback is disabled; use a reviewed forward migration.',
      ),
    );
  }
}
