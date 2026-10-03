-- Disposable container smoke fixture only. Never apply to the hosted database.
CREATE TABLE staff_users (
  worker_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name varchar(255) NOT NULL,
  vocation varchar(100) NOT NULL,
  email varchar(320) NOT NULL UNIQUE,
  username varchar(100) NOT NULL UNIQUE,
  password_hash varchar(255) NOT NULL,
  role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rooms (
  room_number varchar(10) PRIMARY KEY,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bookings (
  booking_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_number varchar(10) REFERENCES rooms(room_number),
  check_in_date date NOT NULL,
  check_out_date date NOT NULL,
  status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
