-- Test-only subset of the previous schema, for DDP-006 adoption/permission checks.
-- Shared tables below are provider fixtures, never production migrations.
CREATE TYPE promotion_discount_type AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');
CREATE TYPE promotion_status AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TABLE mad_promotion_codes (
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
CREATE TABLE bookings (booking_id uuid PRIMARY KEY);
CREATE TABLE staff_users (worker_id uuid PRIMARY KEY, password_hash text);
