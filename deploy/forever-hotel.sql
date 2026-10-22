-- Forever Hotel: consolidated shared schema and MAD additions (PostgreSQL 15+).
-- MANUAL OWNER EXECUTION ONLY. No application startup or local Compose execution.
-- Schema definitions only: this is NOT a Neon data export or a backup.
-- Review against your hosted schema and take a backup before manually applying.
-- Empty public schema: initializes the complete supplied shared schema, then MAD.
-- Existing shared schema: preserves source tables/data; applies idempotent MAD additions.
-- Incomplete shared-table sets fail rather than being silently rebuilt.
-- No users/passwords, room history, source fixtures or fake policy confirmations are seeded.
-- The task-limit requested policy seeds default 3 only if absent; existing values remain.
-- Review commented runtime/WKMS grants using your actual restricted role names.
-- IF NOT EXISTS preserves existing definitions; it is not a general schema-drift repair tool.
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SELECT pg_advisory_xact_lock(1789600057);
DO $mad_initialize$
DECLARE missing_tables text;
BEGIN
  IF to_regclass('public.staff_users') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
    ) THEN
      RAISE EXCEPTION 'Public schema is not empty and staff_users is missing. Reconcile the shared schema manually first.';
    END IF;
    EXECUTE $mad_shared_schema$
-- CLEAN INITIALIZATION ONLY: Run on a NEW/EMPTY PostgreSQL database.
-- Existing databases skip this quoted shared-schema initialization block.
-- Migration ownership belongs to forever-hotel/infra; synchronize remains false.

-- =============================================================================
-- Forever Hotel — Corrected Complete Database Schema (PostgreSQL 15+)
-- Project-wide physical schema aligned to the Forever Hotel SDS and the
-- development-guide conventions, with explicit corrections for normalization,
-- ownership, KMS/FOSS/WKMS relationships, audit logging, and KOT persistence.
--
-- IMPORTANT ARCHITECTURE NOTE
-- ---------------------------
-- The source documents contain an ownership inconsistency:
--   * the FOSS development guide groups FoodOrder/FoodOrderItem/MenuItem/
--     MealCategory under FOSS;
--   * KMS workflows require KMS to manage menu/stock and order states;
--   * the SDS says each service should write only its own tables.
--
-- This corrected schema applies the ADR decision used in this project:
--   KMS owns menu + food-order persistence.
--   FOSS owns FOSSSession + ServiceRequest + Complaint.
--   WKMS owns Task.
--
-- The 16 logical entities described in SDS Chapter 2 remain represented.
-- Additional physical lookup/junction/operational tables are implementation
-- structures and do not change the logical entity count.
-- =============================================================================
-- =============================================================================
-- 0. EXTENSIONS
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- =============================================================================
-- 1. ENUM TYPES
-- =============================================================================
CREATE TYPE booking_status AS ENUM (
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED'
);
CREATE TYPE booking_source AS ENUM (
  'WEBSITE',
  'WALK_IN',
  'BOOKING_LK'
);
CREATE TYPE food_order_meal_period AS ENUM (
  'BREAKFAST',
  'LUNCH',
  'DINNER',
  'TEA_TIME'
);
CREATE TYPE food_order_status AS ENUM (
  'PLACED',
  'IN_PREPARATION',
  'READY',
  'DELIVERED',
  'CANCELLED'
);
CREATE TYPE task_category AS ENUM (
  'ROOM_CLEANING',
  'EXTRA_TOWELS',
  'WATER_BOTTLES',
  'MAINTENANCE',
  'LAUNDRY',
  'FOOD_DELIVERY',
  'OTHER'
);
CREATE TYPE task_priority AS ENUM (
  'HIGH',
  'NORMAL'
);
CREATE TYPE task_status AS ENUM (
  'UNASSIGNED',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'ESCALATED'
);
CREATE TYPE task_source AS ENUM (
  'GUEST_APP',
  'FRONT_DESK',
  'CHECKOUT_TRIGGER',
  'KMS'
);
CREATE TYPE room_status AS ENUM (
  'VACANT',
  'OCCUPIED',
  'REQUIRES_CLEANING',
  'UNDER_MAINTENANCE'
);
CREATE TYPE menu_item_stock_status AS ENUM (
  'AVAILABLE',
  'LOW_STOCK',
  'UNAVAILABLE',
  'TEMPORARILY_DISABLED'
);
CREATE TYPE service_request_category AS ENUM (
  'ROOM_CLEANING',
  'EXTRA_TOWELS',
  'WATER_BOTTLES',
  'MAINTENANCE',
  'LAUNDRY_PICKUP',
  'OTHER'
);
CREATE TYPE service_request_status AS ENUM (
  'SUBMITTED',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED'
);
CREATE TYPE service_request_source AS ENUM (
  'GUEST_APP',
  'FRONT_DESK'
);
CREATE TYPE complaint_severity AS ENUM (
  'LOW',
  'MEDIUM',
  'HIGH'
);
CREATE TYPE complaint_status AS ENUM (
  'SUBMITTED',
  'UNDER_REVIEW',
  'RESOLVED'
);
CREATE TYPE staff_role AS ENUM (
  'MANAGER',
  'RECEPTIONIST',
  'WORKER',
  'KITCHEN_STAFF',
  'KITCHEN_MANAGER'
);
CREATE TYPE promotion_discount_type AS ENUM (
  'PERCENTAGE',
  'FIXED_AMOUNT'
);
CREATE TYPE promotion_status AS ENUM (
  'ACTIVE',
  'INACTIVE'
);
CREATE TYPE payment_method AS ENUM (
  'STRIPE',
  'CASH',
  'CARD_ON_SITE'
);
CREATE TYPE payment_status AS ENUM (
  'PENDING',
  'COMPLETED',
  'REFUNDED',
  'FAILED'
);
-- Operational status for the KOT printing workflow.
CREATE TYPE kot_print_status AS ENUM (
  'PENDING',
  'PRINTED',
  'FAILED',
  'CANCELLED'
);
-- Audit categories mirror the SDS retention-policy categories.
CREATE TYPE audit_event_category AS ENUM (
  'AUTHENTICATION',
  'FRONT_DESK_OPERATION',
  'PAYMENT',
  'STAFF_ACCOUNT_MANAGEMENT',
  'DATA_ACCESS',
  'TASK_SERVICE',
  'FOOD_ORDER'
);
CREATE TYPE audit_actor_type AS ENUM (
  'STAFF',
  'GUEST',
  'SYSTEM',
  'ANONYMOUS'
);
-- =============================================================================
-- 1A. FRONT DESK (FDS) OPERATIONAL ENUMS
--
-- These enums support only Front Desk implementation details that were not
-- represented as separate logical entities in the original 16-entity SDS model.
-- Existing project-wide enums and existing subsystem enums are unchanged.
-- =============================================================================
CREATE TYPE fds_id_verification_method AS ENUM (
  'PHYSICAL_DOCUMENT',
  'SCANNED_COPY'
);
CREATE TYPE fds_identity_document_type AS ENUM (
  'NIC',
  'PASSPORT',
  'OTHER'
);
CREATE TYPE fds_booking_import_status AS ENUM (
  'PENDING',
  'IMPORTED',
  'FAILED'
);
-- =============================================================================
-- 2. CORE / SHARED DOMAIN ENTITIES
-- =============================================================================
-- =============================================================================
-- 2.1 Guest
-- Logical entity from SRS 13.1.2.
--
-- NOTE:
-- SDS Chapter 6 requires guest PII to be encrypted at rest. The physical
-- encryption mechanism/key lookup is intentionally not hard-coded into this
-- DDL because that requires the team's concrete pgcrypto/key-management
-- design. The application/database access layer must satisfy that requirement.
-- =============================================================================
CREATE TABLE guests (
  guest_id        UUID
                    PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name       VARCHAR(255)
                    NOT NULL,
  email           VARCHAR(320)
                    NOT NULL UNIQUE,
  password_hash   VARCHAR(255)
                    NOT NULL,
  nic_or_passport VARCHAR(50),
  phone           VARCHAR(20),
  created_at      TIMESTAMPTZ
                    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
                    NOT NULL DEFAULT NOW()
);
-- =============================================================================
-- 2.2 RoomType
-- SDS 2.2.4 — Transitive Dependency #1
-- =============================================================================
CREATE TABLE room_types (
  room_type_id    UUID
                    PRIMARY KEY DEFAULT uuid_generate_v4(),
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
-- Physical normalization of a multi-valued amenity collection.
CREATE TABLE room_type_amenities (
  room_type_id UUID
                 NOT NULL
                 REFERENCES room_types(room_type_id)
                 ON DELETE CASCADE,
  amenity      VARCHAR(255)
                 NOT NULL,
  created_at   TIMESTAMPTZ
                 NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ
                 NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_type_id, amenity)
);
-- Physical normalization of a multi-valued image collection.
CREATE TABLE room_type_images (
  room_type_id UUID
                 NOT NULL
                 REFERENCES room_types(room_type_id)
                 ON DELETE CASCADE,
  image_url    VARCHAR(500)
                 NOT NULL,
  created_at   TIMESTAMPTZ
                 NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ
                 NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_type_id, image_url)
);
-- =============================================================================
-- 2.3 Room
-- SRS 13.1.5
-- =============================================================================
CREATE TABLE rooms (
  room_number     VARCHAR(10)
                    PRIMARY KEY,
  room_type_id    UUID
                    NOT NULL
                    REFERENCES room_types(room_type_id)
                    ON DELETE RESTRICT,
  floor           INTEGER
                    NOT NULL,
  status          room_status
                    NOT NULL DEFAULT 'VACANT',
  last_cleared_at TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ
                    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
                    NOT NULL DEFAULT NOW()
);
-- =============================================================================
-- 2.4 StaffUser
-- SRS 13.1.8
-- =============================================================================
CREATE TABLE staff_users (
  worker_id       UUID
                    PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name       VARCHAR(255)
                    NOT NULL,
  vocation        VARCHAR(100)
                    NOT NULL,
  email           VARCHAR(320)
                    NOT NULL UNIQUE,
  phone           VARCHAR(20),
  age             INTEGER
                    CHECK (age IS NULL OR age > 0),
  nic             VARCHAR(50),
  username        VARCHAR(100)
                    NOT NULL UNIQUE,
  password_hash   VARCHAR(255)
                    NOT NULL,
  role            staff_role
                    NOT NULL,
  is_active       BOOLEAN
                    NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ
                    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
                    NOT NULL DEFAULT NOW()
);
-- =============================================================================
-- 3. MAD-OWNED TABLES
-- =============================================================================
-- =============================================================================
-- 3.1 PromotionCode
-- SDS 2.2.4 — Transitive Dependency #5
-- =============================================================================
CREATE TABLE mad_promotion_codes (
  promo_id             UUID
                         PRIMARY KEY DEFAULT uuid_generate_v4(),
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
-- =============================================================================
-- 4. BOOKING / PAYMENT DOMAIN
-- =============================================================================
-- =============================================================================
-- 4.1 Booking
-- SRS 13.1.1
--
-- payment_reference has been removed. SDS normalization extracts payment data
-- into the separate Payment entity.
-- =============================================================================
CREATE TABLE bookings (
  booking_id       UUID
                     PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Nullable for an anonymous walk-in booking before a guest account exists.
  guest_id         UUID
                     REFERENCES guests(guest_id)
                     ON DELETE RESTRICT,
  room_type_id     UUID
                     NOT NULL
                     REFERENCES room_types(room_type_id)
                     ON DELETE RESTRICT,
  -- Assigned during check-in.
  room_number      VARCHAR(10)
                     REFERENCES rooms(room_number)
                     ON DELETE RESTRICT,
  promo_id         UUID
                     REFERENCES mad_promotion_codes(promo_id)
                     ON DELETE SET NULL,
  check_in_date    DATE
                     NOT NULL,
  check_out_date   DATE
                     NOT NULL,
  status           booking_status
                     NOT NULL DEFAULT 'PENDING',
  total_amount     INTEGER
                     NOT NULL
                     CHECK (total_amount > 0),
  source           booking_source
                     NOT NULL DEFAULT 'WEBSITE',
  special_requests TEXT,
  num_guests       INTEGER
                     NOT NULL DEFAULT 1
                     CHECK (num_guests > 0),
  created_at       TIMESTAMPTZ
                     NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ
                     NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_booking_dates
    CHECK (check_out_date > check_in_date)
);
-- =============================================================================
-- 4.2 Payment
-- SDS 2.2.4 — Transitive Dependency #6
-- =============================================================================
CREATE TABLE payments (
  payment_id     UUID
                   PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id     UUID
                   NOT NULL
                   REFERENCES bookings(booking_id)
                   ON DELETE RESTRICT,
  payment_method payment_method
                   NOT NULL,
  amount         INTEGER
                   NOT NULL
                   CHECK (amount > 0),
  payment_status payment_status
                   NOT NULL DEFAULT 'PENDING',
  -- Stripe-issued reference only. Raw card data must never be stored.
  stripe_ref     VARCHAR(255)
                   UNIQUE,
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ
                   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ
                   NOT NULL DEFAULT NOW()
);
-- =============================================================================
-- 4A. FDS-OWNED OPERATIONAL TABLES
--
-- IMPORTANT:
-- The existing Guest, Booking, Payment, Room, FOSSSession, ServiceRequest,
-- WKMS Task and system-wide AuditLog definitions remain unchanged.
--
-- The two tables below add only the Front Desk persistence that is missing from
-- the existing physical schema:
--   1) Booking.lk import tracking/idempotency.
--   2) Guest identity-verification evidence for check-in.
--
-- They are implementation-support tables and do not replace or redefine the
-- SDS Chapter-2 logical entities.
-- =============================================================================
-- =============================================================================
-- 4A.1 Booking.lk Reservation Import Tracking
--
-- Front Desk imports reservations from Booking.lk. The actual hotel reservation
-- remains in the existing bookings table with source = 'BOOKING_LK'.
--
-- This table prevents duplicate imports and records the mapping between the
-- external reservation reference and the local booking_id. Raw third-party
-- payloads are intentionally not stored here because they may contain guest PII.
-- =============================================================================
CREATE TABLE fds_booking_imports (
  import_id             UUID
                          PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider              VARCHAR(50)
                          NOT NULL DEFAULT 'BOOKING_LK'
                          CHECK (provider = 'BOOKING_LK'),
  external_booking_ref  VARCHAR(255)
                          NOT NULL,
  booking_id            UUID
                          UNIQUE
                          REFERENCES bookings(booking_id)
                          ON DELETE RESTRICT,
  import_status         fds_booking_import_status
                          NOT NULL DEFAULT 'PENDING',
  -- Optional SHA-256 digest of the source payload for safe change/idempotency
  -- checks without persisting the raw PII-bearing payload.
  payload_sha256        CHAR(64),
  imported_by           UUID
                          REFERENCES staff_users(worker_id)
                          ON DELETE RESTRICT,
  last_attempted_at     TIMESTAMPTZ
                          NOT NULL DEFAULT NOW(),
  imported_at           TIMESTAMPTZ,
  -- Do not place guest PII, access tokens, secrets, or raw external payloads
  -- in this field.
  error_message         VARCHAR(1000),
  created_at            TIMESTAMPTZ
                          NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ
                          NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_fds_booking_import_external_ref
    UNIQUE (provider, external_booking_ref),
  CONSTRAINT chk_fds_booking_import_payload_hash
    CHECK (
      payload_sha256 IS NULL
      OR payload_sha256 ~ '^[0-9A-Fa-f]{64}$'
    ),
  CONSTRAINT chk_fds_booking_import_result
    CHECK (
      (
        import_status = 'PENDING'
        AND booking_id IS NULL
        AND imported_at IS NULL
      )
      OR
      (
        import_status = 'IMPORTED'
        AND booking_id IS NOT NULL
        AND imported_at IS NOT NULL
        AND error_message IS NULL
      )
      OR
      (
        import_status = 'FAILED'
        AND booking_id IS NULL
        AND imported_at IS NULL
        AND error_message IS NOT NULL
      )
    )
);
-- =============================================================================
-- 4A.2 Front Desk Guest Identity Verification
--
-- Supports FD-05 check-in verification.
--
-- The document image/file itself must NOT be stored in PostgreSQL. For a scanned
-- copy, only an opaque object-storage key and optional SHA-256 integrity hash are
-- stored here. The object must be kept in encrypted object storage and accessed
-- only through the authorised application layer.
--
-- For PHYSICAL_DOCUMENT verification, no scanned-file key is required.
-- =============================================================================
CREATE TABLE fds_id_verifications (
  verification_id       UUID
                          PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id            UUID
                          NOT NULL UNIQUE
                          REFERENCES bookings(booking_id)
                          ON DELETE RESTRICT,
  document_type         fds_identity_document_type
                          NOT NULL,
  verification_method   fds_id_verification_method
                          NOT NULL,
  document_storage_key  VARCHAR(500),
  document_sha256       CHAR(64),
  verified_by           UUID
                          NOT NULL
                          REFERENCES staff_users(worker_id)
                          ON DELETE RESTRICT,
  verified_at           TIMESTAMPTZ
                          NOT NULL DEFAULT NOW(),
  notes                 VARCHAR(500),
  created_at            TIMESTAMPTZ
                          NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ
                          NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_fds_id_verification_storage
    CHECK (
      (
        verification_method = 'SCANNED_COPY'
        AND document_storage_key IS NOT NULL
      )
      OR
      (
        verification_method = 'PHYSICAL_DOCUMENT'
        AND document_storage_key IS NULL
      )
    ),
  CONSTRAINT chk_fds_id_verification_hash
    CHECK (
      document_sha256 IS NULL
      OR document_sha256 ~ '^[0-9A-Fa-f]{64}$'
    )
);
-- =============================================================================
-- 5. FOSS-OWNED TABLES
--
-- FOSS owns:
--   FOSSSession
--   ServiceRequest
--   Complaint
--
-- KMS owns menu and food-order persistence under the project ADR.
-- =============================================================================
-- =============================================================================
-- 5.1 FOSSSession
-- SDS 2.2.5
-- =============================================================================
CREATE TABLE foss_sessions (
  session_id     UUID
                   PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id     UUID
                   NOT NULL UNIQUE
                   REFERENCES bookings(booking_id)
                   ON DELETE RESTRICT,
  room_number    VARCHAR(10)
                   NOT NULL
                   REFERENCES rooms(room_number)
                   ON DELETE RESTRICT,
  -- This is the logical FOSSSession token, not the raw room QR secret.
  -- The room QR secret itself must not be stored in plaintext.
  session_token  VARCHAR(500)
                   NOT NULL UNIQUE,
  is_active      BOOLEAN
                   NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ
                   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ
                   NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ
                   NOT NULL,
  CONSTRAINT chk_foss_session_expiry
    CHECK (expires_at > created_at)
);
-- =============================================================================
-- 5.2 ServiceRequest
-- Ownership correction: FOSS owns the guest request record.
-- WKMS owns the Task that executes the request.
-- =============================================================================
CREATE TABLE foss_service_requests (
  request_id    UUID
                  PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id    UUID
                  NOT NULL
                  REFERENCES bookings(booking_id)
                  ON DELETE RESTRICT,
  -- Intentional controlled denormalization for real-time display.
  room_number   VARCHAR(10)
                  NOT NULL
                  REFERENCES rooms(room_number)
                  ON DELETE RESTRICT,
  category      service_request_category
                  NOT NULL,
  description   TEXT,
  status        service_request_status
                  NOT NULL DEFAULT 'SUBMITTED',
  submitted_at  TIMESTAMPTZ
                  NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  source        service_request_source
                  NOT NULL DEFAULT 'GUEST_APP',
  created_at    TIMESTAMPTZ
                  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ
                  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_service_request_completion
    CHECK (
      (status = 'COMPLETED' AND completed_at IS NOT NULL)
      OR
      (status <> 'COMPLETED' AND completed_at IS NULL)
    )
);
-- =============================================================================
-- 6. KMS-OWNED TABLES
-- =============================================================================
-- =============================================================================
-- 6.1 MealCategory
-- SDS 2.2.4 — Transitive Dependency #2
-- =============================================================================
CREATE TABLE kms_meal_categories (
  category_id       UUID
                      PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              VARCHAR(100)
                      NOT NULL UNIQUE,
  description       TEXT,
  order_start_time  TIME
                      NOT NULL,
  order_cutoff_time TIME
                      NOT NULL,
  created_at        TIMESTAMPTZ
                      NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ
                      NOT NULL DEFAULT NOW()
);
-- =============================================================================
-- 6.2 MenuItem
-- SRS 13.1.6
--
-- allergen_tags TEXT[] and dietary_labels TEXT[] have been removed.
-- SDS Chapter 2 explicitly says these multi-valued attributes are resolved
-- into separate physical tables.
-- =============================================================================
CREATE TABLE kms_menu_items (
  menu_item_id      UUID
                      PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id       UUID
                      NOT NULL
                      REFERENCES kms_meal_categories(category_id)
                      ON DELETE RESTRICT,
  name              VARCHAR(255)
                      NOT NULL,
  description       TEXT,
  price             INTEGER
                      NOT NULL
                      CHECK (price > 0),
  preparation_time  INTEGER
                      NOT NULL
                      CHECK (preparation_time > 0),
  portion_limit     INTEGER
                      NOT NULL DEFAULT 5
                      CHECK (portion_limit > 0),
  stock_status      menu_item_stock_status
                      NOT NULL DEFAULT 'AVAILABLE',
  image_url         VARCHAR(500),
  created_at        TIMESTAMPTZ
                      NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ
                      NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_menu_item_category_name
    UNIQUE (category_id, name)
);
-- =============================================================================
-- 6.2.1 Allergen lookup + junction
-- =============================================================================
CREATE TABLE kms_allergens (
  allergen_id UUID
                PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(100)
                NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ
                NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ
                NOT NULL DEFAULT NOW()
);
CREATE TABLE kms_menu_item_allergens (
  menu_item_id UUID
                 NOT NULL
                 REFERENCES kms_menu_items(menu_item_id)
                 ON DELETE CASCADE,
  allergen_id  UUID
                 NOT NULL
                 REFERENCES kms_allergens(allergen_id)
                 ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ
                 NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ
                 NOT NULL DEFAULT NOW(),
  PRIMARY KEY (menu_item_id, allergen_id)
);
-- =============================================================================
-- 6.2.2 Dietary-label lookup + junction
-- =============================================================================
CREATE TABLE kms_dietary_labels (
  dietary_label_id UUID
                     PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             VARCHAR(100)
                     NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ
                     NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ
                     NOT NULL DEFAULT NOW()
);
CREATE TABLE kms_menu_item_dietary_labels (
  menu_item_id     UUID
                     NOT NULL
                     REFERENCES kms_menu_items(menu_item_id)
                     ON DELETE CASCADE,
  dietary_label_id UUID
                     NOT NULL
                     REFERENCES kms_dietary_labels(dietary_label_id)
                     ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ
                     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ
                     NOT NULL DEFAULT NOW(),
  PRIMARY KEY (menu_item_id, dietary_label_id)
);
-- =============================================================================
-- 6.3 FoodOrder
-- SRS 13.1.3
--
-- KMS is the project ADR's authoritative owner of the operational order state.
-- =============================================================================
CREATE TABLE kms_food_orders (
  order_id                UUID
                            PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id              UUID
                            NOT NULL
                            REFERENCES bookings(booking_id)
                            ON DELETE RESTRICT,
  -- Intentional controlled denormalization required by the SDS for KMS display.
  room_number             VARCHAR(10)
                            NOT NULL
                            REFERENCES rooms(room_number)
                            ON DELETE RESTRICT,
  meal_period             food_order_meal_period
                            NOT NULL,
  allergy_note            VARCHAR(300),
  -- Supports the KMS allergy-confirmation flow.
  allergy_acknowledged_by UUID
                            REFERENCES staff_users(worker_id)
                            ON DELETE RESTRICT,
  allergy_acknowledged_at TIMESTAMPTZ,
  status                  food_order_status
                            NOT NULL DEFAULT 'PLACED',
  total_amount            INTEGER
                            NOT NULL
                            CHECK (total_amount >= 0),
  placed_at               TIMESTAMPTZ
                            NOT NULL DEFAULT NOW(),
  estimated_delivery_time TIMESTAMPTZ,
  preparation_started_at  TIMESTAMPTZ,
  ready_at                TIMESTAMPTZ,
  delivered_at            TIMESTAMPTZ,
  cancelled_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ
                            NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ
                            NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_allergy_ack_pair
    CHECK (
      (
        allergy_acknowledged_by IS NULL
        AND allergy_acknowledged_at IS NULL
      )
      OR
      (
        allergy_acknowledged_by IS NOT NULL
        AND allergy_acknowledged_at IS NOT NULL
      )
    ),
  CONSTRAINT chk_allergy_ack_requires_note
    CHECK (
      allergy_acknowledged_at IS NULL
      OR allergy_note IS NOT NULL
    ),
  CONSTRAINT chk_order_timestamp_sequence
    CHECK (
      (ready_at IS NULL OR preparation_started_at IS NOT NULL)
      AND
      (delivered_at IS NULL OR ready_at IS NOT NULL)
    ),
  CONSTRAINT chk_cancel_before_preparation
    CHECK (
      cancelled_at IS NULL
      OR preparation_started_at IS NULL
    )
);
-- =============================================================================
-- 6.4 FoodOrderItem
-- SDS 2.2.2 — junction entity for FoodOrder <-> MenuItem
-- =============================================================================
CREATE TABLE kms_food_order_items (
  order_item_id UUID
                  PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID
                  NOT NULL
                  REFERENCES kms_food_orders(order_id)
                  ON DELETE CASCADE,
  menu_item_id  UUID
                  NOT NULL
                  REFERENCES kms_menu_items(menu_item_id)
                  ON DELETE RESTRICT,
  -- Snapshot at ordering time.
  name          VARCHAR(255)
                  NOT NULL,
  quantity      INTEGER
                  NOT NULL
                  CHECK (quantity > 0),
  -- Snapshot at ordering time.
  unit_price    INTEGER
                  NOT NULL
                  CHECK (unit_price > 0),
  special_note  VARCHAR(300),
  created_at    TIMESTAMPTZ
                  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ
                  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_food_order_menu_item
    UNIQUE (order_id, menu_item_id)
);
-- =============================================================================
-- 6.5 KOTPrint
--
-- Operational persistence for the class-diagram/printing workflow.
-- Print requests are sent by KMS to the separate Printing Service; this
-- database table does not initiate printing or implement retry orchestration.
-- A KOT identifier is the primary key. Multiple records per order are permitted
-- by the current schema: duplicate/reprint semantics remain an integration
-- contract decision (KMS-INT-07), not an implicit UNIQUE(order_id) rule.
-- This is not one of the 16 normalized Chapter-2 logical entities.
-- =============================================================================
CREATE TABLE kms_kot_prints (
  kot_id        UUID
                  PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID
                  NOT NULL
                  REFERENCES kms_food_orders(order_id)
                  ON DELETE RESTRICT,
  print_status  kot_print_status
                  NOT NULL DEFAULT 'PENDING',
  printed_at    TIMESTAMPTZ,
  is_cancelled  BOOLEAN
                  NOT NULL DEFAULT FALSE,
  printer_name  VARCHAR(255),
  reprinted_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ
                  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ
                  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_kot_printed_at
    CHECK (
      print_status <> 'PRINTED'
      OR printed_at IS NOT NULL
    ),

  -- Keep the legacy cancellation flag consistent with the status enum.
  -- Application updates must change both fields in the same transaction.
  CONSTRAINT chk_kot_cancellation_consistency
    CHECK (is_cancelled = (print_status = 'CANCELLED'))
);
-- =============================================================================
-- 6.6 FOSS Complaint
-- SRS 13.1.9
-- Placed after KMS tables only so referenced_order_id can have an immediate FK.
-- Logical owner remains FOSS.
-- =============================================================================
CREATE TABLE foss_complaints (
  complaint_id          UUID
                          PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id            UUID
                          NOT NULL
                          REFERENCES bookings(booking_id)
                          ON DELETE RESTRICT,
  -- Intentional controlled denormalization.
  room_number           VARCHAR(10)
                          NOT NULL
                          REFERENCES rooms(room_number)
                          ON DELETE RESTRICT,
  category              VARCHAR(100)
                          NOT NULL,
  description           TEXT
                          NOT NULL,
  severity              complaint_severity
                          NOT NULL,
  -- Optional complaint references.
  referenced_order_id   UUID
                          REFERENCES kms_food_orders(order_id)
                          DEFERRABLE INITIALLY DEFERRED,
  referenced_request_id UUID
                          REFERENCES foss_service_requests(request_id)
                          ON DELETE RESTRICT,
  referenced_worker_id  UUID
                          REFERENCES staff_users(worker_id)
                          ON DELETE RESTRICT,
  status                complaint_status
                          NOT NULL DEFAULT 'SUBMITTED',
  resolution_notes      TEXT,
  submitted_at          TIMESTAMPTZ
                          NOT NULL DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ
                          NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ
                          NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_complaint_resolution
    CHECK (
      (status = 'RESOLVED' AND resolved_at IS NOT NULL)
      OR
      (status <> 'RESOLVED' AND resolved_at IS NULL)
    )
);
-- =============================================================================
-- 7. WKMS-OWNED TABLES
-- =============================================================================
-- =============================================================================
-- 7.1 Task
-- SRS 13.1.4
--
-- Supports the three task-generation relationships described in SDS Chapter 2:
-- Booking -> Task, ServiceRequest -> Task, and KMS food delivery -> Task.
-- =============================================================================
CREATE TABLE wkms_tasks (
  task_id            UUID
                       PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_number        VARCHAR(10)
                       NOT NULL
                       REFERENCES rooms(room_number)
                       ON DELETE RESTRICT,
  category           task_category
                       NOT NULL,
  description        TEXT,
  priority           task_priority
                       NOT NULL DEFAULT 'NORMAL',
  status             task_status
                       NOT NULL DEFAULT 'UNASSIGNED',
  assigned_worker_id UUID
                       REFERENCES staff_users(worker_id)
                       ON DELETE RESTRICT,
  -- Used for booking-generated tasks such as checkout cleaning.
  booking_id         UUID
                       REFERENCES bookings(booking_id)
                       ON DELETE RESTRICT,
  -- SDS describes ServiceRequest <-> Task as 1:1.
  service_request_id UUID
                       UNIQUE
                       REFERENCES foss_service_requests(request_id)
                       ON DELETE RESTRICT,
  -- Used for the specialised food-delivery task generated by KMS.
  food_order_id      UUID
                       UNIQUE
                       REFERENCES kms_food_orders(order_id)
                       ON DELETE RESTRICT,
  submitted_at       TIMESTAMPTZ
                       NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ,
  source             task_source
                       NOT NULL,
  created_at         TIMESTAMPTZ
                       NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ
                       NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_task_completion
    CHECK (
      (status = 'COMPLETED' AND completed_at IS NOT NULL)
      OR
      (status <> 'COMPLETED' AND completed_at IS NULL)
    ),
  -- Enforces the three task-generation paths documented in the SDS:
  -- ServiceRequest -> Task, KMS food-delivery -> Task, and Checkout -> Task.
  CONSTRAINT chk_task_source_reference
    CHECK (
      (
        source IN ('GUEST_APP', 'FRONT_DESK')
        AND service_request_id IS NOT NULL
        AND food_order_id IS NULL
      )
      OR
      (
        source = 'KMS'
        AND category = 'FOOD_DELIVERY'
        AND food_order_id IS NOT NULL
        AND service_request_id IS NULL
      )
      OR
      (
        source = 'CHECKOUT_TRIGGER'
        AND booking_id IS NOT NULL
        AND service_request_id IS NULL
        AND food_order_id IS NULL
      )
    )
);
-- =============================================================================
-- 7.2 WKMS Task-Escalation Transactional Outbox (DDP-77)
--
-- Stores the RabbitMQ event in the SAME PostgreSQL statement/transaction as
-- the task's UNASSIGNED -> ESCALATED transition. The background dispatcher
-- retries PENDING events until RabbitMQ publication is confirmed.
-- event_id is deterministic for an escalation (escalation:<task UUID>).
-- No FK on task_id: the event remains independent of subsequent task lifecycle
-- actions, matching the implemented migration and dispatcher contract.
-- =============================================================================
CREATE TABLE wkms_event_outbox (
  event_id          TEXT PRIMARY KEY,
  task_id           UUID NOT NULL,
  event_type        VARCHAR(100) NOT NULL,
  routing_key       VARCHAR(150) NOT NULL,
  payload           JSONB NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'PUBLISHED')),
  attempt_count     INTEGER NOT NULL DEFAULT 0
                      CHECK (attempt_count >= 0),
  last_attempt_at   TIMESTAMPTZ,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at      TIMESTAMPTZ
);
-- =============================================================================
-- 8. SYSTEM-WIDE AUDIT LOG
--
-- The original schema incorrectly treated AuditLog as FDS-owned and required
-- a StaffUser for every entry. SDS Chapter 6 requires audit events across
-- authentication, payments, staff management, data access, tasks/services,
-- and food orders, including events that may not have a staff actor.
--
-- Application DB roles must have INSERT + SELECT only on this table.
-- UPDATE/DELETE must not be granted to application roles.
-- =============================================================================
CREATE TABLE audit_logs (
  log_id            UUID
                      PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_category    audit_event_category
                      NOT NULL,
  actor_type        audit_actor_type
                      NOT NULL,
  staff_user_id     UUID
                      REFERENCES staff_users(worker_id)
                      ON DELETE RESTRICT,
  guest_id          UUID
                      REFERENCES guests(guest_id)
                      ON DELETE RESTRICT,
  foss_session_id   UUID
                      REFERENCES foss_sessions(session_id)
                      ON DELETE RESTRICT,
  action            VARCHAR(100)
                      NOT NULL,
  entity_type       VARCHAR(100)
                      NOT NULL,
  -- TEXT is intentional because audited entities do not all use UUID keys
  -- (e.g. Room uses room_number).
  entity_id         VARCHAR(255),
  details           JSONB,
  ip_address        VARCHAR(45),
  created_at        TIMESTAMPTZ
                      NOT NULL DEFAULT NOW(),
  -- Required by SRS 13.3. Since AuditLog is append-only, this remains
  -- equal to the insertion-time value.
  updated_at        TIMESTAMPTZ
                      NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_audit_staff_actor
    CHECK (
      actor_type <> 'STAFF'
      OR staff_user_id IS NOT NULL
    ),
  CONSTRAINT chk_audit_guest_actor
    CHECK (
      actor_type <> 'GUEST'
      OR guest_id IS NOT NULL
      OR foss_session_id IS NOT NULL
    )
);
-- =============================================================================
-- 9. INDEXES
-- =============================================================================
-- Guest/core lookups
CREATE INDEX idx_guests_email
  ON guests(email);
CREATE INDEX idx_rooms_status
  ON rooms(status);
CREATE INDEX idx_rooms_room_type
  ON rooms(room_type_id);
CREATE INDEX idx_staff_users_role
  ON staff_users(role);
CREATE INDEX idx_staff_users_active
  ON staff_users(is_active);
-- Booking/payment lookups
CREATE INDEX idx_bookings_guest_id
  ON bookings(guest_id);
CREATE INDEX idx_bookings_status
  ON bookings(status);
CREATE INDEX idx_bookings_check_in
  ON bookings(check_in_date);
CREATE INDEX idx_bookings_room_type
  ON bookings(room_type_id);
CREATE INDEX idx_bookings_room_number
  ON bookings(room_number);
CREATE INDEX idx_payments_booking
  ON payments(booking_id);
CREATE INDEX idx_payments_status
  ON payments(payment_status);
-- MAD lookups
CREATE INDEX idx_promotions_status
  ON mad_promotion_codes(status);
CREATE INDEX idx_promotions_validity
  ON mad_promotion_codes(valid_from, valid_until);
CREATE INDEX idx_promotion_room_types_room_type
  ON mad_promotion_room_types(room_type_id);
-- Front Desk lookup/performance support
--
-- These indexes do not change ownership or the logical structure of the shared
-- tables. They support FD-02/FD-03 reservation search, daily arrivals/departures,
-- and room/date availability checks.
CREATE INDEX idx_guests_full_name_lower
  ON guests (LOWER(full_name));
CREATE INDEX idx_guests_nic_or_passport
  ON guests(nic_or_passport);
CREATE INDEX idx_guests_phone
  ON guests(phone);
CREATE INDEX idx_bookings_arrivals
  ON bookings(check_in_date, status);
CREATE INDEX idx_bookings_departures
  ON bookings(check_out_date, status);
CREATE INDEX idx_bookings_room_dates_status
  ON bookings(room_number, check_in_date, check_out_date, status);
CREATE INDEX idx_fds_booking_imports_status
  ON fds_booking_imports(import_status);
CREATE INDEX idx_fds_booking_imports_booking
  ON fds_booking_imports(booking_id);
CREATE INDEX idx_fds_booking_imports_last_attempted
  ON fds_booking_imports(last_attempted_at);
CREATE INDEX idx_fds_id_verifications_verified_by
  ON fds_id_verifications(verified_by);
CREATE INDEX idx_fds_id_verifications_verified_at
  ON fds_id_verifications(verified_at);
-- FOSS session lookups
CREATE INDEX idx_foss_sessions_room
  ON foss_sessions(room_number);
CREATE INDEX idx_foss_sessions_active
  ON foss_sessions(is_active);
CREATE INDEX idx_foss_sessions_expires
  ON foss_sessions(expires_at);
-- FOSS service-request lookups
CREATE INDEX idx_service_requests_status
  ON foss_service_requests(status);
CREATE INDEX idx_service_requests_booking
  ON foss_service_requests(booking_id);
CREATE INDEX idx_service_requests_room
  ON foss_service_requests(room_number);
-- FOSS complaint lookups
CREATE INDEX idx_complaints_status
  ON foss_complaints(status);
CREATE INDEX idx_complaints_booking
  ON foss_complaints(booking_id);
CREATE INDEX idx_complaints_order
  ON foss_complaints(referenced_order_id);
CREATE INDEX idx_complaints_request
  ON foss_complaints(referenced_request_id);
CREATE INDEX idx_complaints_worker
  ON foss_complaints(referenced_worker_id);
-- KMS menu lookups
CREATE INDEX idx_kms_menu_items_category
  ON kms_menu_items(category_id);
CREATE INDEX idx_kms_menu_items_stock
  ON kms_menu_items(stock_status);
-- KMS food-order lookups
CREATE INDEX idx_food_orders_status
  ON kms_food_orders(status);
CREATE INDEX idx_food_orders_placed_at
  ON kms_food_orders(placed_at);
CREATE INDEX idx_food_orders_booking
  ON kms_food_orders(booking_id);
CREATE INDEX idx_food_orders_room
  ON kms_food_orders(room_number);
-- Common Kanban query: status + FIFO order.
CREATE INDEX idx_food_orders_kanban
  ON kms_food_orders(status, placed_at);
CREATE INDEX idx_food_order_items_order
  ON kms_food_order_items(order_id);
CREATE INDEX idx_food_order_items_menu_item
  ON kms_food_order_items(menu_item_id);
CREATE INDEX idx_kot_prints_order
  ON kms_kot_prints(order_id);
CREATE INDEX idx_kot_prints_status
  ON kms_kot_prints(print_status);
-- WKMS task queue
CREATE INDEX idx_tasks_status
  ON wkms_tasks(status);
CREATE INDEX idx_tasks_submitted_at
  ON wkms_tasks(submitted_at);
CREATE INDEX idx_tasks_worker
  ON wkms_tasks(assigned_worker_id);
CREATE INDEX idx_tasks_booking
  ON wkms_tasks(booking_id);
CREATE INDEX idx_tasks_service_request
  ON wkms_tasks(service_request_id);
CREATE INDEX idx_tasks_food_order
  ON wkms_tasks(food_order_id);
CREATE INDEX idx_tasks_queue
  ON wkms_tasks(status, submitted_at);
-- DDP-77: efficient scan of pending escalation events
CREATE INDEX idx_wkms_outbox_pending
  ON wkms_event_outbox (created_at)
  WHERE status = 'PENDING';
-- Audit lookups
CREATE INDEX idx_audit_logs_category
  ON audit_logs(event_category);
CREATE INDEX idx_audit_logs_staff
  ON audit_logs(staff_user_id);
CREATE INDEX idx_audit_logs_guest
  ON audit_logs(guest_id);
CREATE INDEX idx_audit_logs_session
  ON audit_logs(foss_session_id);
CREATE INDEX idx_audit_logs_entity
  ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at
  ON audit_logs(created_at);
-- =============================================================================
-- 10. AUTO-UPDATE updated_at
-- =============================================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'guests',
      'room_types',
      'room_type_amenities',
      'room_type_images',
      'rooms',
      'staff_users',
      'mad_promotion_codes',
      'mad_promotion_room_types',
      'bookings',
      'payments',
      'fds_booking_imports',
      'fds_id_verifications',
      'foss_sessions',
      'foss_service_requests',
      'foss_complaints',
      'kms_meal_categories',
      'kms_menu_items',
      'kms_allergens',
      'kms_menu_item_allergens',
      'kms_dietary_labels',
      'kms_menu_item_dietary_labels',
      'kms_food_orders',
      'kms_food_order_items',
      'kms_kot_prints',
      'wkms_tasks'
    ])
  LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at
       BEFORE UPDATE ON %I
       FOR EACH ROW
       EXECUTE FUNCTION trigger_set_updated_at();',
      tbl
    );
  END LOOP;
END;
$$;
-- =============================================================================
-- 11. IMPORTANT APPLICATION / MIGRATION RULES
-- =============================================================================
--
-- 1. Use migrations in development/staging/production.
--    Do not use ORM synchronize=true in production.
--
-- 2. FOSS must not directly write KMS-owned tables under the accepted ADR.
--    Cross-service changes must go through approved REST/event contracts.
--
-- 3. KMS owns the operational FoodOrder status state machine:
--
--       PLACED
--         | \\
--         |  \--> CANCELLED
--         v
--       IN_PREPARATION
--         |
--         v
--       READY
--         |
--         v
--       DELIVERED
--
-- 4. The complete state-transition rules must also be enforced in NestJS.
--    SQL constraints do not replace domain-service validation.
--
-- 5. Orders with allergy_note must not move to IN_PREPARATION until the
--    allergy warning has been acknowledged.
--
-- 6. Cancellation eligibility (including the configured cancellation window)
--    must be checked atomically by the KMS application/service transaction.
--
-- 7. Free-text validation/sanitization required by SDS Chapter 6 must be
--    enforced at DTO/application level as well as through column lengths.
--
-- 8. PII encryption at rest, TLS, JWT verification, and bcrypt configuration
--    are security implementation requirements and are not fully expressible
--    through relational DDL alone.
--
-- 9. AuditLog is append-only for application roles. Grant application roles
--    INSERT/SELECT only; do not grant UPDATE/DELETE. Its updated_at column is
--    present to satisfy SRS 13.3 and remains equal to its insertion-time value.
--
-- 10. Folio is intentionally not stored as a base table here. SDS Chapter 2
--     does not include Folio in the normalized entity set; checkout flow
--     generates the itemized folio from booking/order/service/payment data.
--
-- 11. kms_kot_prints is an operational persistence table justified by the
--     SDS class diagram and printing workflow, not an extra Chapter-2 logical
--     business entity.
--     Its cancellation boolean must agree with print_status.
--     This schema does not yet store individual retry attempts or a separate
--     correlation key; those require an approved KMS-INT-07 revision.
--
-- 12. Front Desk additions in this schema are intentionally limited to
--     fds_booking_imports and fds_id_verifications plus supporting indexes.
--     Existing non-FDS table definitions are unchanged.
--
-- 13. Booking.lk import must be idempotent. A successful import creates or links
--     exactly one existing bookings row whose source is BOOKING_LK. The
--     (provider, external_booking_ref) unique constraint is the database-side
--     safety net; the NestJS service must still implement the transaction.
--
-- 14. A scanned NIC/passport file must not be stored in PostgreSQL. Store it in
--     encrypted object storage and persist only its opaque storage key (and,
--     optionally, its SHA-256 hash) in fds_id_verifications.
--
-- 15. FDS must not directly modify FOSS-owned or WKMS-owned tables for
--     cross-service workflows. Examples:
--       * guest-session activation/deactivation -> approved FOSS contract
--       * front-desk service request -> approved FOSS/WKMS contract
--       * escalation/manual worker assignment -> approved WKMS contract
--       * checkout cleaning task -> RabbitMQ/approved WKMS contract
--
-- 16. Check-in, check-out, room reassignment, maintenance blocking and manual
--     task assignment must be written to the existing append-only audit_logs
--     table by the responsible service/application flow.
--
-- 17. Front Desk domain transitions must be transaction-safe at application
--     level. In particular, room availability must be re-checked before
--     assigning/changing a room, and checkout must not be marked complete until
--     the required payment/state changes have succeeded.
--
-- =============================================================================

$mad_shared_schema$;
  END IF;
  SELECT string_agg(name, ', ' ORDER BY name) INTO missing_tables
  FROM unnest(ARRAY['guests','room_types','room_type_amenities','room_type_images','rooms','staff_users','mad_promotion_codes','mad_promotion_room_types','bookings','payments','fds_booking_imports','fds_id_verifications','foss_sessions','foss_service_requests','kms_meal_categories','kms_menu_items','kms_allergens','kms_menu_item_allergens','kms_dietary_labels','kms_menu_item_dietary_labels','kms_food_orders','kms_food_order_items','kms_kot_prints','foss_complaints','wkms_tasks','wkms_event_outbox','audit_logs']) AS required(name)
  WHERE to_regclass('public.' || quote_ident(name)) IS NULL;
  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Shared schema incomplete; missing tables: %', missing_tables;
  END IF;
END $mad_initialize$;

-- BEGIN MAD SECTION: auth
-- MANUAL ONLY: minimal login/readiness provisioning after the base schema.
-- Review and apply as the schema owner; this never runs on application startup.

ALTER TABLE public.staff_users
  ADD COLUMN IF NOT EXISTS password_change_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0 CHECK (session_version >= 0),
  ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;

CREATE TABLE IF NOT EXISTS public.mad_revoked_sessions (
  token_hash char(64) PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS mad_revoked_expiry ON public.mad_revoked_sessions(expires_at);
REVOKE ALL ON public.mad_revoked_sessions FROM PUBLIC;
-- END MAD SECTION: auth

-- BEGIN MAD SECTION: supplement
-- MANUAL ONLY: review and apply after the shared-schema initialization below.
-- Application startup and Compose never execute this file.

-- Apply the auth section first for login/readiness support.

CREATE OR REPLACE VIEW public.mad_booking_analytics AS
SELECT booking_id, check_in_date, status::text AS status, updated_at
FROM public.bookings;

-- The supplied schema has no room activation/retirement or dated maintenance.
-- Owners must supply actual dates. No history is inferred or seeded here.
CREATE TABLE IF NOT EXISTS public.mad_room_availability (
  room_number varchar(10) PRIMARY KEY REFERENCES public.rooms(room_number),
  active_from date NOT NULL,
  active_to date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (active_to IS NULL OR active_to > active_from)
);
CREATE TABLE IF NOT EXISTS public.mad_room_maintenance (
  maintenance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_number varchar(10) NOT NULL REFERENCES public.rooms(room_number),
  start_date date NOT NULL,
  end_date date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date > start_date)
);
REVOKE ALL ON public.mad_room_availability, public.mad_room_maintenance FROM PUBLIC;

CREATE OR REPLACE VIEW public.mad_occupancy_rooms AS
SELECT r.room_number AS room_id, a.active_from, a.active_to,
       greatest(r.updated_at, a.updated_at) AS updated_at
FROM public.rooms r LEFT JOIN public.mad_room_availability a USING (room_number);

CREATE OR REPLACE VIEW public.mad_occupancy_allocations AS
SELECT booking_id, room_number AS room_id, check_in_date, check_out_date,
       status::text AS status, updated_at
FROM public.bookings WHERE room_number IS NOT NULL;

CREATE OR REPLACE VIEW public.mad_occupancy_maintenance AS
SELECT room_number AS room_id, start_date, end_date, updated_at
FROM public.mad_room_maintenance;
-- END MAD SECTION: supplement

-- BEGIN MAD SECTION: staff
-- Apply manually after the shared schema and the auth section. Never run at application startup.

-- Existing case-insensitive duplicate emails must be resolved by the database owner first.
CREATE UNIQUE INDEX IF NOT EXISTS staff_users_email_case_unique ON public.staff_users (lower(email));
CREATE TABLE IF NOT EXISTS public.mad_staff_deliveries (
  delivery_id uuid PRIMARY KEY,
  worker_id uuid NOT NULL UNIQUE REFERENCES public.staff_users(worker_id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','failed','sent','cancelled')),
  encrypted_credentials text,
  credential_version integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  last_error_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CHECK ((status IN ('pending','failed')) = (encrypted_credentials IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS mad_staff_deliveries_due ON public.mad_staff_deliveries(next_attempt_at)
  WHERE status IN ('pending','failed');
REVOKE ALL ON public.mad_staff_deliveries FROM PUBLIC;
-- END MAD SECTION: staff

-- BEGIN MAD SECTION: promotions
-- DDP-018: manual DBA execution only. Never invoked by the application or Compose.
-- Requires the corrected shared schema's mad_promotion_codes,
-- mad_promotion_room_types and room_types tables. This does not rewrite existing data.

-- Fails and rolls back if legacy normalized duplicates exist. Review them manually;
-- do not silently merge promotions or alter their redemption history.
CREATE UNIQUE INDEX IF NOT EXISTS mad_promotion_code_normalized_unique
  ON public.mad_promotion_codes (upper(btrim(code_string)));

-- DBA: grant the actual runtime role (substitute its name before execution):
-- GRANT SELECT, INSERT ON public.mad_promotion_codes, public.mad_promotion_room_types TO mad_runtime;
-- GRANT SELECT ON public.room_types TO mad_runtime;
-- END MAD SECTION: promotions

-- BEGIN MAD SECTION: promotion-lifecycle
-- DDP-019: owner-reviewed MANUAL SQL only; no application startup migrations.
-- Apply after the corrected shared schema and the promotions section.

ALTER TABLE public.mad_promotion_codes
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='public.mad_promotion_codes'::regclass
      AND conname='mad_deleted_promotion_inactive') THEN
    ALTER TABLE public.mad_promotion_codes ADD CONSTRAINT mad_deleted_promotion_inactive
      CHECK (deleted_at IS NULL OR status='INACTIVE');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.mad_promotion_outbox (
  event_id uuid PRIMARY KEY,
  promo_id uuid NOT NULL REFERENCES public.mad_promotion_codes(promo_id) ON DELETE RESTRICT,
  promotion_version integer NOT NULL CHECK (promotion_version >= 0),
  event_type text NOT NULL CHECK (event_type IN ('promotion.upsert','promotion.deleted')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  UNIQUE (promo_id,promotion_version)
);
CREATE INDEX IF NOT EXISTS mad_promotion_outbox_pending
  ON public.mad_promotion_outbox(created_at,event_id) WHERE published_at IS NULL;

-- Replace mad_runtime with the actual runtime role before applying these grants:
-- GRANT SELECT,INSERT,UPDATE ON public.mad_promotion_codes TO mad_runtime;
-- GRANT SELECT,INSERT,DELETE ON public.mad_promotion_room_types TO mad_runtime;
-- GRANT SELECT,INSERT ON public.mad_promotion_outbox TO mad_runtime;
-- GRANT SELECT ON public.room_types TO mad_runtime;
-- Outbox publication/acknowledgement permissions belong to the DDP-040 publisher.
-- END MAD SECTION: promotion-lifecycle

-- BEGIN MAD SECTION: promotion-publication
-- DDP-040 MANUAL ONLY, after the promotion-lifecycle section.
-- No source/booking changes; no startup execution. Review grants as schema owner.

ALTER TABLE public.mad_promotion_outbox
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS mad_promotion_outbox_retry
  ON public.mad_promotion_outbox(next_attempt_at,created_at,event_id)
  WHERE published_at IS NULL;

-- Replace mad_runtime with the actual restricted publisher role:
-- GRANT SELECT,UPDATE ON public.mad_promotion_outbox TO mad_runtime;
-- No promotion/redemption/booking write grants are needed by the publisher.
-- END MAD SECTION: promotion-publication

-- BEGIN MAD SECTION: complaints
-- DDP-021: MANUAL owner-reviewed supplement after the shared schema.
-- Do not run at startup. FOSS retains complaint creation and guest-owned fields.

CREATE TABLE IF NOT EXISTS public.mad_complaint_state (
  complaint_id uuid PRIMARY KEY REFERENCES public.foss_complaints(complaint_id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1)
);
CREATE TABLE IF NOT EXISTS public.mad_complaint_history (
  complaint_id uuid NOT NULL REFERENCES public.foss_complaints(complaint_id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  from_status text NOT NULL,
  to_status text NOT NULL,
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 4000),
  actor_id uuid NOT NULL REFERENCES public.staff_users(worker_id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY(complaint_id,version),
  CHECK ((from_status='SUBMITTED' AND to_status='UNDER_REVIEW') OR
         (from_status='UNDER_REVIEW' AND to_status='RESOLVED'))
);
CREATE TABLE IF NOT EXISTS public.mad_complaint_outbox (
  event_id uuid PRIMARY KEY,
  complaint_id uuid NOT NULL REFERENCES public.foss_complaints(complaint_id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  UNIQUE(complaint_id,version)
);
CREATE INDEX IF NOT EXISTS mad_complaint_outbox_pending
  ON public.mad_complaint_outbox(created_at,event_id) WHERE published_at IS NULL;
REVOKE ALL ON public.mad_complaint_state, public.mad_complaint_history, public.mad_complaint_outbox FROM PUBLIC;

-- Replace mad_runtime with a dedicated MAD role, then apply as owner:
-- GRANT SELECT(complaint_id,category,description,referenced_worker_id,submitted_at,status,resolved_at)
--   ON public.foss_complaints TO mad_runtime;
-- GRANT UPDATE(status,resolved_at) ON public.foss_complaints TO mad_runtime;
-- GRANT SELECT,INSERT,UPDATE ON public.mad_complaint_state TO mad_runtime;
-- GRANT SELECT,INSERT ON public.mad_complaint_history TO mad_runtime;
-- GRANT INSERT ON public.mad_complaint_outbox TO mad_runtime;
-- FOSS/guest runtime roles must have NO access to the three MAD tables (including
-- through inherited grants). Do not use a shared owner/superuser runtime role.
-- FOSS creates SUBMITTED complaints; MAD is the sole status/resolved_at writer.
-- Existing shared resolution_notes are untouched. Do not copy private notes there.
-- The event publisher uses separate owner-reviewed SELECT/UPDATE grants.
-- END MAD SECTION: complaints

-- BEGIN MAD SECTION: realtime
-- DDP-039: manually apply after owner review. Never run at application startup.

CREATE TABLE IF NOT EXISTS mad_realtime_versions (
  order_id uuid PRIMARY KEY,
  version bigint NOT NULL CHECK (version >= 0)
);
CREATE TABLE IF NOT EXISTS mad_realtime_events (
  event_id uuid PRIMARY KEY,
  order_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version >= 0),
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS mad_realtime_pending_idx
  ON mad_realtime_events(received_at,event_id) WHERE delivered_at IS NULL;

-- Substitute your restricted MAD role; do not grant these to guest/FOSS/KMS roles.
-- GRANT SELECT,INSERT,UPDATE ON mad_realtime_events,mad_realtime_versions TO mad_runtime;
-- GRANT SELECT(order_id,room_number,meal_period,status,placed_at,updated_at,delivered_at)
--   ON kms_food_orders TO mad_runtime;
-- GRANT SELECT(order_id,quantity) ON kms_food_order_items TO mad_runtime;
-- END MAD SECTION: realtime

-- BEGIN MAD SECTION: rooms
-- DDP-027: manual MAD-only supplement. Do not execute at application startup.

CREATE TABLE IF NOT EXISTS mad_room_versions (
 room_id varchar(10) PRIMARY KEY, version bigint NOT NULL CHECK(version>=0)
);
CREATE TABLE IF NOT EXISTS mad_room_events (
 event_id uuid PRIMARY KEY, room_id varchar(10) NOT NULL,
 version bigint NOT NULL CHECK(version>=0), payload jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS mad_room_events_pending_idx ON mad_room_events(received_at,event_id) WHERE delivered_at IS NULL;

-- Replace mad_runtime with your restricted runtime role after review:
-- GRANT SELECT(room_number,room_type_id,floor,status,updated_at) ON rooms TO mad_runtime;
-- GRANT SELECT(room_type_id,type_name) ON room_types TO mad_runtime;
-- GRANT SELECT,INSERT,UPDATE ON mad_room_events,mad_room_versions TO mad_runtime;
-- END MAD SECTION: rooms

-- BEGIN MAD SECTION: tasks
-- DDP-028 / DDP-042: review and run manually. Never run on application startup.

CREATE TABLE IF NOT EXISTS mad_task_versions (
 task_id uuid PRIMARY KEY, version bigint NOT NULL CHECK(version>=0)
);
CREATE TABLE IF NOT EXISTS mad_task_events (
 event_id uuid PRIMARY KEY, task_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>=0), payload jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS mad_task_events_pending_idx
 ON mad_task_events(received_at,event_id) WHERE delivered_at IS NULL;

-- Replace mad_runtime with the restricted MAD runtime role after review.
-- GRANT SELECT(task_id,room_number,category,priority,status,assigned_worker_id,
-- submitted_at,completed_at,updated_at) ON wkms_tasks TO mad_runtime;
-- GRANT SELECT(worker_id,full_name) ON staff_users TO mad_runtime;
-- GRANT SELECT,INSERT,UPDATE ON mad_task_events,mad_task_versions TO mad_runtime;
-- MAD must have no write privileges on WKMS tasks. Check inherited grants as well.
-- END MAD SECTION: tasks

-- BEGIN MAD SECTION: stock
-- DDP-034: review and apply manually after the shared KMS schema. Never run at startup.

CREATE TABLE IF NOT EXISTS public.mad_stock_alerts (
 alert_id uuid PRIMARY KEY, menu_item_id uuid NOT NULL UNIQUE,
 item_name varchar(255) NOT NULL, stock_status text NOT NULL CHECK(stock_status IN ('AVAILABLE','LOW_STOCK','UNAVAILABLE','TEMPORARILY_DISABLED')),
 active boolean NOT NULL,version bigint NOT NULL CHECK(version BETWEEN 0 AND 9007199254740991),
 source_updated_at timestamptz NOT NULL,raised_at timestamptz,cleared_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(active=(stock_status<>'AVAILABLE')),
 CHECK(NOT active OR (raised_at IS NOT NULL AND cleared_at IS NULL))
);
CREATE INDEX IF NOT EXISTS mad_stock_alerts_active_idx ON public.mad_stock_alerts(updated_at,menu_item_id) WHERE active;
CREATE TABLE IF NOT EXISTS public.mad_stock_events (
 event_id uuid PRIMARY KEY,menu_item_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version BETWEEN 0 AND 9007199254740991),
 received_payload jsonb NOT NULL,payload jsonb,
 delivery_state text NOT NULL CHECK(delivery_state IN ('pending','published','superseded')),
 received_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz,
 CHECK(payload IS NOT NULL OR delivery_state='superseded')
);
CREATE INDEX IF NOT EXISTS mad_stock_events_pending_idx ON public.mad_stock_events(received_at,event_id) WHERE delivery_state='pending';
REVOKE ALL ON public.mad_stock_alerts,public.mad_stock_events FROM PUBLIC;

-- Replace mad_runtime with your restricted MAD runtime role after review:
-- GRANT SELECT(menu_item_id,name,stock_status,updated_at) ON public.kms_menu_items TO mad_runtime;
-- GRANT SELECT,INSERT,UPDATE ON public.mad_stock_alerts,public.mad_stock_events TO mad_runtime;
-- No KMS source-table INSERT/UPDATE/DELETE grants are required.
-- END MAD SECTION: stock

-- BEGIN MAD SECTION: notifications
-- DDP-043. Review and apply manually after auth and complaint supplements.
-- Never executed by application startup. Does not modify source issues.

CREATE TABLE IF NOT EXISTS public.mad_notification_reads (
 manager_id uuid NOT NULL REFERENCES public.staff_users(worker_id),
 type text NOT NULL CHECK(type IN ('COMPLAINT','STOCK')),
 entity_id uuid NOT NULL,
 revision varchar(100) NOT NULL CHECK(revision ~ '^[A-Z0-9:_-]{1,100}$'),
 read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(manager_id,type,entity_id)
);
REVOKE ALL ON public.mad_notification_reads FROM PUBLIC;

-- Replace mad_runtime with the reviewed dedicated MAD runtime role:
-- GRANT SELECT,INSERT,UPDATE ON public.mad_notification_reads TO mad_runtime;
-- GRANT SELECT(complaint_id,category,status,submitted_at) ON public.foss_complaints TO mad_runtime;
-- GRANT SELECT(complaint_id,version) ON public.mad_complaint_state TO mad_runtime;
-- GRANT SELECT(menu_item_id,name,stock_status,updated_at) ON public.kms_menu_items TO mad_runtime;
-- No source INSERT/UPDATE/DELETE privileges are required for notifications.
-- END MAD SECTION: notifications

-- BEGIN MAD SECTION: task-limit
-- DDP-045: review/apply manually after the shared staff/auth schema.
-- No task rows are changed. Never run at application startup.

CREATE TABLE IF NOT EXISTS public.mad_task_limit_history (
 version integer PRIMARY KEY CHECK(version>=0),
 task_limit smallint NOT NULL CHECK(task_limit BETWEEN 1 AND 10),
 changed_by uuid REFERENCES public.staff_users(worker_id),
 changed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(version,task_limit)
);
INSERT INTO public.mad_task_limit_history(version,task_limit) VALUES(0,3) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.mad_task_limit_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 requested_limit smallint NOT NULL CHECK(requested_limit BETWEEN 1 AND 10),
 version integer NOT NULL CHECK(version>=0),
 updated_by uuid REFERENCES public.staff_users(worker_id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(version,requested_limit) REFERENCES public.mad_task_limit_history(version,task_limit) DEFERRABLE INITIALLY DEFERRED
);
INSERT INTO public.mad_task_limit_policy(singleton,requested_limit,version) VALUES(true,3,0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.mad_task_limit_ack (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 version integer NOT NULL CHECK(version>=0),
 task_limit smallint NOT NULL CHECK(task_limit BETWEEN 1 AND 10),
 applied_at timestamptz NOT NULL DEFAULT now(),
 confirmed_by name NOT NULL,
 FOREIGN KEY(version,task_limit) REFERENCES public.mad_task_limit_history(version,task_limit)
);
-- WKMS calls this in the SAME transaction as activating its claim-enforced policy.
-- It must lock mad_task_limit_policy first and use the same lock order for claims.
CREATE OR REPLACE FUNCTION public.mad_confirm_task_limit(expected_version integer, applied_limit integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy public.mad_task_limit_policy%ROWTYPE;
BEGIN
 SELECT * INTO policy FROM public.mad_task_limit_policy WHERE singleton FOR UPDATE;
 IF NOT FOUND OR expected_version IS DISTINCT FROM policy.version OR applied_limit IS DISTINCT FROM policy.requested_limit THEN
  RAISE EXCEPTION 'TASK_LIMIT_POLICY_CHANGED' USING ERRCODE='40001';
 END IF;
 INSERT INTO public.mad_task_limit_ack AS ack(singleton,version,task_limit,applied_at,confirmed_by)
 VALUES(true,expected_version,applied_limit,clock_timestamp(),session_user)
 ON CONFLICT(singleton) DO UPDATE SET version=EXCLUDED.version,task_limit=EXCLUDED.task_limit,
 applied_at=EXCLUDED.applied_at,confirmed_by=EXCLUDED.confirmed_by
 WHERE ack.version < EXCLUDED.version;
END $$;
REVOKE ALL ON public.mad_task_limit_policy,public.mad_task_limit_history,public.mad_task_limit_ack FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mad_confirm_task_limit(integer,integer) FROM PUBLIC;

-- Review/replace actual role names. MAD must not own these tables/functions.
-- GRANT SELECT ON public.mad_task_limit_policy,public.mad_task_limit_history,public.mad_task_limit_ack TO mad_runtime;
-- GRANT UPDATE(requested_limit,version,updated_by,updated_at) ON public.mad_task_limit_policy TO mad_runtime;
-- GRANT INSERT ON public.mad_task_limit_history TO mad_runtime;
-- GRANT SELECT ON public.mad_task_limit_policy,public.mad_task_limit_history TO wkms_runtime;
-- SELECT FOR SHARE/UPDATE row locks require an UPDATE privilege in PostgreSQL.
-- Grant only the immutable singleton column; its CHECK/PK prevent alternate keys.
-- GRANT UPDATE(singleton) ON public.mad_task_limit_policy TO wkms_runtime;
-- GRANT EXECUTE ON FUNCTION public.mad_confirm_task_limit(integer,integer) TO wkms_runtime;
-- Never grant MAD acknowledgement writes/confirmation execution, or WKMS value/version/history writes.
-- Revoke inherited/PUBLIC permissions and use separate dedicated login roles.
-- END MAD SECTION: task-limit

-- BEGIN MAD SECTION: food-analytics
-- DDP-023: optional MANUAL grant template; no schema/data changes required.
-- Run as the owner only after replacing mad_runtime with the dedicated MAD role.
-- Existing equivalent read grants need not be repeated. Never run at startup.
-- GRANT SELECT(order_id,placed_at,status,updated_at) ON public.kms_food_orders TO mad_runtime;
-- GRANT SELECT(order_id,menu_item_id,name,quantity,updated_at) ON public.kms_food_order_items TO mad_runtime;
-- MAD requires no INSERT/UPDATE/DELETE or guest/allergy/special-note access.
-- END MAD SECTION: food-analytics

-- BEGIN MAD SECTION: service-analytics
-- DDP-024 optional MANUAL grant template. No schema changes, no startup execution.
-- Owner: replace mad_runtime with the dedicated MAD role if reads are missing.
-- GRANT SELECT(request_id,status,submitted_at,completed_at,updated_at)
--   ON public.foss_service_requests TO mad_runtime;
-- No write permissions, guest fields or WKMS task access required.
-- END MAD SECTION: service-analytics

-- BEGIN MAD SECTION: worker-analytics
-- DDP-025 optional manual reporting grants. No schema change is required.
-- The database owner must substitute the dedicated runtime role and review
-- these grants with WKMS/FOSS. No commands execute automatically.
-- GRANT SELECT(worker_id,full_name,role,is_active,updated_at)
--   ON public.staff_users TO mad_runtime;
-- GRANT SELECT(assigned_worker_id,status,submitted_at,completed_at,updated_at)
--   ON public.wkms_tasks TO mad_runtime;
-- GRANT SELECT(referenced_worker_id,status,submitted_at,updated_at)
--   ON public.foss_complaints TO mad_runtime;
-- END MAD SECTION: worker-analytics

COMMIT;
