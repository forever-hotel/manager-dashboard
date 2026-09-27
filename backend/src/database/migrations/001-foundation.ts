import { MigrationInterface, QueryRunner } from 'typeorm';

export class MadFoundation1789600000000 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(`
      DO $$ BEGIN
        IF to_regclass('public.promotion_codes') IS NOT NULL THEN
          RAISE EXCEPTION 'Unprefixed promotion_codes requires an owner-approved forward migration; no records have been moved';
        END IF;
      END $$;
      DO $$ BEGIN CREATE TYPE promotion_discount_type AS ENUM ('PERCENTAGE','FIXED_AMOUNT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE TYPE promotion_status AS ENUM ('ACTIVE','INACTIVE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE TABLE IF NOT EXISTS mad_promotion_codes (
        promo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code_string varchar(50) NOT NULL UNIQUE,
        discount_type promotion_discount_type NOT NULL,
        discount_value integer NOT NULL CHECK (discount_value > 0),
        valid_from timestamptz NOT NULL,
        valid_until timestamptz NOT NULL,
        applicable_room_types uuid[],
        max_redemptions integer NOT NULL DEFAULT 100,
        current_redemptions integer NOT NULL DEFAULT 0,
        status promotion_status NOT NULL DEFAULT 'ACTIVE',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_promo_dates CHECK (valid_until > valid_from)
      );
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mad_promotion_codes'::regclass AND conname = 'mad_redemption_bounds') THEN
          ALTER TABLE mad_promotion_codes ADD CONSTRAINT mad_redemption_bounds CHECK (max_redemptions >= 0 AND current_redemptions >= 0 AND current_redemptions <= max_redemptions);
        END IF;
      END $$;
      CREATE INDEX IF NOT EXISTS idx_promotions_status ON mad_promotion_codes(status);
      CREATE INDEX IF NOT EXISTS idx_promotions_validity ON mad_promotion_codes(valid_from, valid_until);
      CREATE TABLE IF NOT EXISTS mad_revoked_sessions (
        token_hash char(64) PRIMARY KEY,
        expires_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS mad_revoked_expiry ON mad_revoked_sessions(expires_at);
    `);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Destructive rollback is disabled. Restore a backup or apply a reviewed forward migration.',
      ),
    );
  }
}
