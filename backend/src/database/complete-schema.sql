-- =============================================================================
-- Forever Hotel — Complete Database Schema (PostgreSQL 15+)
-- SDS Chapter 2 (Database Design) | SRS Chapter 13 (Data Requirements)
-- All 16 entities across 6 microservices sharing a single PostgreSQL instance.
-- Tables are prefixed by subsystem where applicable (SDS Section 1.5.2).
-- =============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. ENUM TYPES
-- =============================================================================

CREATE TYPE booking_status AS ENUM (
  'PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'
);

CREATE TYPE booking_source AS ENUM (
  'WEBSITE', 'WALK_IN', 'BOOKING_LK'
);

CREATE TYPE food_order_meal_period AS ENUM (
  'BREAKFAST', 'LUNCH', 'DINNER', 'TEA_TIME'
);

CREATE TYPE food_order_status AS ENUM (
  'PLACED', 'IN_PREPARATION', 'READY', 'DELIVERED', 'CANCELLED'
);

CREATE TYPE task_category AS ENUM (
  'ROOM_CLEANING', 'EXTRA_TOWELS', 'WATER_BOTTLES',
  'MAINTENANCE', 'LAUNDRY', 'FOOD_DELIVERY', 'OTHER'
);

CREATE TYPE task_priority AS ENUM ('HIGH', 'NORMAL');

CREATE TYPE task_status AS ENUM (
  'UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'ESCALATED'
);

CREATE TYPE task_source AS ENUM (
  'GUEST_APP', 'FRONT_DESK', 'CHECKOUT_TRIGGER', 'KMS'
);

CREATE TYPE room_status AS ENUM (
  'VACANT', 'OCCUPIED', 'REQUIRES_CLEANING', 'UNDER_MAINTENANCE'
);

CREATE TYPE menu_item_stock_status AS ENUM (
  'AVAILABLE', 'LOW_STOCK', 'UNAVAILABLE', 'TEMPORARILY_DISABLED'
);

CREATE TYPE service_request_category AS ENUM (
  'ROOM_CLEANING', 'EXTRA_TOWELS', 'WATER_BOTTLES',
  'MAINTENANCE', 'LAUNDRY_PICKUP', 'OTHER'
);

CREATE TYPE service_request_status AS ENUM (
  'SUBMITTED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'
);

CREATE TYPE service_request_source AS ENUM ('GUEST_APP', 'FRONT_DESK');

CREATE TYPE complaint_severity AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TYPE complaint_status AS ENUM (
  'SUBMITTED', 'UNDER_REVIEW', 'RESOLVED'
);

CREATE TYPE staff_role AS ENUM (
  'MANAGER', 'RECEPTIONIST', 'WORKER', 'KITCHEN_STAFF', 'KITCHEN_MANAGER'
);

CREATE TYPE promotion_discount_type AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

CREATE TYPE promotion_status AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TYPE payment_method AS ENUM (
  'STRIPE', 'CASH', 'CARD_ON_SITE'
);

CREATE TYPE payment_status AS ENUM (
  'PENDING', 'COMPLETED', 'REFUNDED', 'FAILED'
);

-- =============================================================================
-- 2. CORE ENTITIES (shared across subsystems)
-- =============================================================================

-- 2.1  Guest  (SRS 13.1.2 — Table 28)
CREATE TABLE guests (
  guest_id        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name       VARCHAR(255) NOT NULL,
  email           VARCHAR(320) NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  nic_or_passport VARCHAR(50),
  phone           VARCHAR(20),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2.2  RoomType  (SDS 2.2.4 — Transitive Dep #1)
CREATE TABLE room_types (
  room_type_id    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  type_name       VARCHAR(100)  NOT NULL UNIQUE,
  price_per_night INTEGER       NOT NULL CHECK (price_per_night > 0),  -- LKR cents
  max_guests      INTEGER       NOT NULL CHECK (max_guests > 0),
  description     TEXT,
  amenities       TEXT[],
  image_urls      TEXT[],
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 2.3  Room  (SRS 13.1.5 — Table 31)
CREATE TABLE rooms (
  room_number     VARCHAR(10)   PRIMARY KEY,
  room_type_id    UUID          NOT NULL REFERENCES room_types(room_type_id),
  floor           INTEGER       NOT NULL,
  status          room_status   NOT NULL DEFAULT 'VACANT',
  last_cleared_at TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 2.4  StaffUser  (SRS 13.1.8 — Table 34 | SDS: candidate keys username, email)
CREATE TABLE staff_users (
  worker_id       UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name       VARCHAR(255)  NOT NULL,
  vocation        VARCHAR(100)  NOT NULL,
  email           VARCHAR(320)  NOT NULL UNIQUE,
  phone           VARCHAR(20),
  age             INTEGER,
  nic             VARCHAR(50),
  username        VARCHAR(100)  NOT NULL UNIQUE,
  password_hash   VARCHAR(255)  NOT NULL,
  role            staff_role    NOT NULL,
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 3. MAD-OWNED TABLES (Manager Analytical Dashboard)
-- =============================================================================

-- 3.1  PromotionCode  (SDS 2.2.4 — Transitive Dep #5 | SRS MD-05)
CREATE TABLE mad_promotion_codes (
  promo_id              UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
  code_string           VARCHAR(50)             NOT NULL UNIQUE,
  discount_type         promotion_discount_type NOT NULL,
  discount_value        INTEGER                 NOT NULL CHECK (discount_value > 0),  -- percentage or LKR cents
  valid_from            TIMESTAMPTZ             NOT NULL,
  valid_until           TIMESTAMPTZ             NOT NULL,
  applicable_room_types UUID[],                 -- array of room_type_id references
  max_redemptions       INTEGER                 NOT NULL DEFAULT 100,
  current_redemptions   INTEGER                 NOT NULL DEFAULT 0,
  status                promotion_status        NOT NULL DEFAULT 'ACTIVE',
  created_at            TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_promo_dates CHECK (valid_until > valid_from)
);

-- =============================================================================
-- 4. HW-OWNED TABLES (Hotel Website bookings & payments)
-- =============================================================================

-- 4.1  Booking  (SRS 13.1.1 — Table 27)
CREATE TABLE bookings (
  booking_id        UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  guest_id          UUID            NOT NULL REFERENCES guests(guest_id),
  room_type_id      UUID            NOT NULL REFERENCES room_types(room_type_id),
  room_number       VARCHAR(10)     REFERENCES rooms(room_number),  -- assigned at check-in
  promo_id          UUID            REFERENCES mad_promotion_codes(promo_id),
  check_in_date     DATE            NOT NULL,
  check_out_date    DATE            NOT NULL,
  status            booking_status  NOT NULL DEFAULT 'PENDING',
  total_amount      INTEGER         NOT NULL CHECK (total_amount > 0),  -- LKR cents
  payment_reference VARCHAR(255),   -- Stripe PaymentIntent ID
  source            booking_source  NOT NULL DEFAULT 'WEBSITE',
  special_requests  TEXT,
  num_guests        INTEGER         NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_booking_dates CHECK (check_out_date > check_in_date)
);

-- 4.2  Payment  (SDS 2.2.4 — Transitive Dep #6)
CREATE TABLE payments (
  payment_id      UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id      UUID            NOT NULL REFERENCES bookings(booking_id),
  payment_method  payment_method  NOT NULL,
  amount          INTEGER         NOT NULL CHECK (amount > 0),  -- LKR cents
  payment_status  payment_status  NOT NULL DEFAULT 'PENDING',
  stripe_ref      VARCHAR(255),
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 5. FOSS-OWNED TABLES (Food Ordering & Service Request — Guest App)
-- =============================================================================

-- 5.1  FOSSSession  (SDS 2.2.5 — candidate key sessionToken)
CREATE TABLE foss_sessions (
  session_id     UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id     UUID          NOT NULL UNIQUE REFERENCES bookings(booking_id),
  room_number    VARCHAR(10)   NOT NULL REFERENCES rooms(room_number),
  session_token  VARCHAR(500)  NOT NULL UNIQUE,
  is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ   NOT NULL
);

-- =============================================================================
-- 6. KMS-OWNED TABLES (Kitchen Management System)
-- =============================================================================

-- 6.1  MealCategory  (SDS 2.2.4 — Transitive Dep #2)
CREATE TABLE kms_meal_categories (
  category_id      UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             VARCHAR(100)  NOT NULL UNIQUE,
  order_start_time TIME          NOT NULL,
  order_cutoff_time TIME         NOT NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 6.2  MenuItem  (SRS 13.1.6 — Table 32)
CREATE TABLE kms_menu_items (
  menu_item_id     UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id      UUID                  NOT NULL REFERENCES kms_meal_categories(category_id),
  name             VARCHAR(255)          NOT NULL,
  description      TEXT,
  price            INTEGER               NOT NULL CHECK (price > 0),  -- LKR cents
  preparation_time INTEGER               NOT NULL,  -- minutes
  allergen_tags    TEXT[],
  dietary_labels   TEXT[],
  portion_limit    INTEGER               NOT NULL DEFAULT 5,
  stock_status     menu_item_stock_status NOT NULL DEFAULT 'AVAILABLE',
  image_url        VARCHAR(500),
  created_at       TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

-- 6.3  FoodOrder  (SRS 13.1.3 — Table 29)
CREATE TABLE kms_food_orders (
  order_id               UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id             UUID                  NOT NULL REFERENCES bookings(booking_id),
  room_number            VARCHAR(10)           NOT NULL,  -- denormalised (SRS 13.1.3)
  meal_period            food_order_meal_period NOT NULL,
  allergy_note           VARCHAR(300),
  status                 food_order_status      NOT NULL DEFAULT 'PLACED',
  total_amount           INTEGER               NOT NULL CHECK (total_amount >= 0),  -- LKR cents
  placed_at              TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  estimated_delivery_time TIMESTAMPTZ,
  created_at             TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

-- 6.4  FoodOrderItem  (SDS 2.2.2 — junction entity for FoodOrder ↔ MenuItem)
CREATE TABLE kms_food_order_items (
  order_item_id   UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID          NOT NULL REFERENCES kms_food_orders(order_id) ON DELETE CASCADE,
  menu_item_id    UUID          NOT NULL REFERENCES kms_menu_items(menu_item_id),
  name            VARCHAR(255)  NOT NULL,  -- snapshot at order time
  quantity        INTEGER       NOT NULL CHECK (quantity > 0),
  unit_price      INTEGER       NOT NULL CHECK (unit_price > 0),  -- LKR cents, snapshot
  special_note    VARCHAR(300),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 7. WKMS-OWNED TABLES (Worker Management System)
-- =============================================================================

-- 7.1  ServiceRequest  (SRS 13.1.7 — Table 33)
CREATE TABLE wkms_service_requests (
  request_id    UUID                      PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id    UUID                      NOT NULL REFERENCES bookings(booking_id),
  room_number   VARCHAR(10)               NOT NULL,  -- denormalised (SRS 13.1.7)
  category      service_request_category  NOT NULL,
  description   TEXT,
  status        service_request_status    NOT NULL DEFAULT 'SUBMITTED',
  submitted_at  TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  source        service_request_source    NOT NULL DEFAULT 'GUEST_APP',
  created_at    TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ               NOT NULL DEFAULT NOW()
);

-- 7.2  Task  (SRS 13.1.4 — Table 30)
CREATE TABLE wkms_tasks (
  task_id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_number        VARCHAR(10)   NOT NULL,  -- denormalised (SRS 13.1.4)
  category           task_category NOT NULL,
  description        TEXT,
  priority           task_priority NOT NULL DEFAULT 'NORMAL',
  status             task_status   NOT NULL DEFAULT 'UNASSIGNED',
  assigned_worker_id UUID          REFERENCES staff_users(worker_id),
  submitted_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ,
  source             task_source   NOT NULL,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 8. GUEST-APP / FOSS COMPLAINTS
-- =============================================================================

-- 8.1  Complaint  (SRS 13.1.9 — Table 35)
CREATE TABLE complaints (
  complaint_id         UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id           UUID              NOT NULL REFERENCES bookings(booking_id),
  room_number          VARCHAR(10)       NOT NULL,  -- denormalised (SRS 13.1.9)
  category             VARCHAR(100)      NOT NULL,
  description          TEXT              NOT NULL,
  severity             complaint_severity NOT NULL,
  referenced_order_id  UUID              REFERENCES kms_food_orders(order_id),
  referenced_request_id UUID            REFERENCES wkms_service_requests(request_id),
  referenced_worker_id UUID              REFERENCES staff_users(worker_id),
  status               complaint_status  NOT NULL DEFAULT 'SUBMITTED',
  resolution_notes     TEXT,
  submitted_at         TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  resolved_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 9. FDS-OWNED TABLES (Front Desk System — Audit Log)
-- =============================================================================

-- 9.1  AuditLog  (SDS Table 9 — append-only, 3-year retention)
CREATE TABLE fds_audit_logs (
  log_id        UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_user_id UUID          NOT NULL REFERENCES staff_users(worker_id),
  action        VARCHAR(100)  NOT NULL,
  entity_type   VARCHAR(100)  NOT NULL,
  entity_id     UUID,
  details       JSONB,
  ip_address    VARCHAR(45),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 10. INDEXES (performance-critical paths)
-- =============================================================================

-- Booking lookups
CREATE INDEX idx_bookings_guest_id      ON bookings(guest_id);
CREATE INDEX idx_bookings_status        ON bookings(status);
CREATE INDEX idx_bookings_check_in      ON bookings(check_in_date);
CREATE INDEX idx_bookings_room_type     ON bookings(room_type_id);

-- Food order lookups (KMS Kanban / MAD analytics)
CREATE INDEX idx_food_orders_status     ON kms_food_orders(status);
CREATE INDEX idx_food_orders_placed_at  ON kms_food_orders(placed_at);
CREATE INDEX idx_food_orders_booking    ON kms_food_orders(booking_id);

-- Task queue (WKMS FIFO)
CREATE INDEX idx_tasks_status           ON wkms_tasks(status);
CREATE INDEX idx_tasks_submitted_at     ON wkms_tasks(submitted_at);
CREATE INDEX idx_tasks_worker           ON wkms_tasks(assigned_worker_id);

-- Service requests
CREATE INDEX idx_service_requests_status ON wkms_service_requests(status);
CREATE INDEX idx_service_requests_booking ON wkms_service_requests(booking_id);

-- Complaints (MAD complaint register)
CREATE INDEX idx_complaints_status      ON complaints(status);
CREATE INDEX idx_complaints_booking     ON complaints(booking_id);

-- Room status board (FDS / MAD)
CREATE INDEX idx_rooms_status           ON rooms(status);

-- Staff users
CREATE INDEX idx_staff_users_role       ON staff_users(role);
CREATE INDEX idx_staff_users_active     ON staff_users(is_active);

-- Audit logs (FDS — append-only)
CREATE INDEX idx_audit_logs_staff       ON fds_audit_logs(staff_user_id);
CREATE INDEX idx_audit_logs_entity      ON fds_audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at  ON fds_audit_logs(created_at);

-- Payments
CREATE INDEX idx_payments_booking       ON payments(booking_id);

-- Promotions (MAD)
CREATE INDEX idx_promotions_status      ON mad_promotion_codes(status);
CREATE INDEX idx_promotions_validity    ON mad_promotion_codes(valid_from, valid_until);

-- =============================================================================
-- 11. TRIGGER: auto-update updated_at columns
-- =============================================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the trigger to all tables with updated_at
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'guests', 'room_types', 'rooms', 'staff_users',
      'mad_promotion_codes', 'bookings', 'payments',
      'kms_meal_categories', 'kms_menu_items', 'kms_food_orders',
      'wkms_service_requests', 'wkms_tasks', 'complaints'
    ])
  LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();',
      tbl
    );
  END LOOP;
END;
$$;
