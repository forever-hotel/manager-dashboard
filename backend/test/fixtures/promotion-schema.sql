-- TEST ONLY: corrected shared-schema subset for a fresh disposable database.
CREATE TYPE promotion_discount_type AS ENUM ('PERCENTAGE','FIXED_AMOUNT');
CREATE TYPE promotion_status AS ENUM ('ACTIVE','INACTIVE');
CREATE TABLE room_types (
  room_type_id    UUID
                    PRIMARY KEY DEFAULT gen_random_uuid(),
  type_name       VARCHAR(100)
                    NOT NULL UNIQUE,
  price_per_night INTEGER
                    NOT NULL
                    CHECK (price_per_night > 0),
  max_guests      INTEGER
                    NOT NULL
                    CHECK (max_guests > 0),
  description     TEXT,
  created_at      TIMESTAMPTZ
                    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
                    NOT NULL DEFAULT NOW()
);
CREATE TABLE mad_promotion_codes (
  promo_id             UUID
                         PRIMARY KEY DEFAULT gen_random_uuid(),
  code_string          VARCHAR(50)
                         NOT NULL UNIQUE,
  discount_type        promotion_discount_type
                         NOT NULL,
  discount_value       INTEGER
                         NOT NULL
                         CHECK (discount_value > 0),
  valid_from           TIMESTAMPTZ
                         NOT NULL,
  valid_until          TIMESTAMPTZ
                         NOT NULL,
  max_redemptions      INTEGER
                         NOT NULL DEFAULT 100
                         CHECK (max_redemptions > 0),
  current_redemptions  INTEGER
                         NOT NULL DEFAULT 0
                         CHECK (current_redemptions >= 0),
  status               promotion_status
                         NOT NULL DEFAULT 'ACTIVE',
  created_at           TIMESTAMPTZ
                         NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ
                         NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_promotion_dates
    CHECK (valid_until > valid_from),
  CONSTRAINT chk_promotion_redemptions
    CHECK (current_redemptions <= max_redemptions),
  CONSTRAINT chk_percentage_discount
    CHECK (
      discount_type <> 'PERCENTAGE'
      OR discount_value <= 100
    )
);
-- Replaces the non-atomic applicable_room_types UUID[] representation.
CREATE TABLE mad_promotion_room_types (
  promo_id     UUID
                 NOT NULL
                 REFERENCES mad_promotion_codes(promo_id)
                 ON DELETE CASCADE,
  room_type_id UUID
                 NOT NULL
                 REFERENCES room_types(room_type_id)
                 ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ
                 NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ
                 NOT NULL DEFAULT NOW(),
  PRIMARY KEY (promo_id, room_type_id)
);
