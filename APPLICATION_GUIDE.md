# Manager dashboard with Neon

## How the application works

The browser opens the Next.js frontend at http://localhost:3000. Its server-side
adapter sends requests to the Fastify gateway at http://api-gateway:8080 inside
Docker. The gateway forwards MAD requests to the NestJS backend at
http://mad-backend:4000. The backend connects to hosted Neon PostgreSQL over TLS.

The gateway only routes requests; MAD owns manager login and authorization.
The browser keeps an HttpOnly, SameSite=Strict session cookie. The frontend sends
its token to MAD through the gateway as a bearer header. MAD issues eight-hour
JWTs and validates the staff account, MANAGER role, session version and revocations.
Password changes invalidate older sessions; five failed password attempts lock an
account for 15 minutes. New accounts must change their initial password.

Gateway `/mad/auth/*` maps to backend `/auth/*`; business `/mad/*` paths remain
unchanged. Root Compose enables only MAD routes. The independent gateway's
[handoff guide](api-gateway/DEVELOPER_GUIDE.md) covers all six subsystem teams.

## Hosted configuration

Copy `.env.example` to `.env` only if you do not already have one. Each variable
must be on its own line. Remove Markdown backslashes and HTML `&#x20;` fragments.
Never commit credentials. Root Compose reads root `.env`; a host-run backend uses
`backend/.env`. The private files have been configured separately from examples.

```dotenv
DB_HOST=your-branch.ap-southeast-1.aws.neon.tech
DB_PORT=5432
DB_USERNAME=your_database_role
DB_PASSWORD=your-private-password
DB_NAME=forever
DB_SSL=true
DB_SYNCHRONIZE=false
DB_LOGGING=false
```

Use the direct, non-pooled endpoint supplied by your database administrator.
DB_SSL enables TLS with certificate verification. DB_SYNCHRONIZE=true is rejected:
this shared schema must not be changed by ORM startup. Credentials are URL-encoded
when constructing the connection string. DATABASE_URL is also supported for
existing tooling, takes precedence over DB_* settings, and must not contain query
parameters; use DB_SSL for TLS. Compose uses the separate DB_* fields.

Keep JWT_SECRET (32+ characters), JWT_ISSUER=mad, FRONTEND_URL and APP_ORIGIN
configured. Frontend origin defaults to http://localhost:3000. Public gateway URL
NEXT_PUBLIC_API_URL defaults to http://localhost:8080. Gateway source must exist at
`api-gateway/` or at API_GATEWAY_CONTEXT; it is supplied separately and Git-ignored.
The backend remains on port 4000 to avoid the frontend's port 3000.

## Manual schema prerequisite

The application targets the supplied `docs/forever_hotel_full_schema.sql`.
It does not execute that file. If the base schema is already deployed, do not
rerun its CREATE TABLE/TYPE statements.

Review and manually apply [neon-mad-auth.sql](deploy/neon-mad-auth.sql)
for login/readiness, then [neon-mad-supplement.sql](deploy/neon-mad-supplement.sql)
for analytics in Neon after the base schema. This approved supplement has NOT been executed.
It adds:

- Staff account lockout, forced password change and session version columns.
- MAD session revocations for logout.
- Booking/occupancy reporting views using `bookings` and `rooms`.
- Dated room availability and maintenance tables absent from the supplied schema.

Login reads `staff_users.worker_id`, `username`, `password_hash`, `role` and
`is_active`. Only MANAGER accounts can access MAD. The old mad_manager_accounts
store is no longer used; existing accounts there are not automatically moved.
The current password implementation uses salted scrypt; passwords created by a
different subsystem with another hash format require an agreed compatibility
implementation before those accounts can log in. No existing hashes are rewritten.

The supplement changes no existing staff passwords. Its new forced-change flag
starts true. Existing shared-service password/deactivation workflows must also
increment session_version when invalidating sessions across applications.

The supplied schema's normalized promotion/room-type junction is preserved.
Promotion management is not implemented by this foundation; the application does
not recreate the older promotion array column or run legacy migrations on Neon.

The database role needs SELECT on staff_users and reporting views, UPDATE on
password_hash/password_change_required/session_version/failed_attempts/locked_until/
updated_at, and SELECT/INSERT on mad_revoked_sessions. Provisioning additionally
needs INSERT on staff_users. Use a dedicated restricted application role when
available; the supplied owner role has broader privileges.

## Booking and occupancy data

Booking totals count check-in DATE values in Asia/Colombo, Monday-start weeks,
including CONFIRMED, CHECKED_IN and CHECKED_OUT. Booking enums are cast to text by
the reporting view to match the API queries.

The occupancy view uses bookings.room_number as its room identifier. Bookings
without an assigned room do not count as occupied rooms. Supply verified
active_from/active_to dates in mad_room_availability for every room and all known
maintenance intervals in mad_room_maintenance. End dates are exclusive. Keep
updated_at current when changing those records. No dates are guessed or seeded.
Missing room availability makes occupancy return 503 rather than misleading zeros.
An empty maintenance table means no recorded maintenance: the data owner must
confirm completeness. Current rooms.status cannot reconstruct historical outages.

## Run locally

```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps --all
docker compose logs -f mad-backend api-gateway mad-frontend
```

Compose starts only mad-backend, api-gateway and mad-frontend. There is no local
PostgreSQL service and no migration job. No schema changes run at startup.
Gateway startup waits for backend readiness. The frontend starts independently
and displays unavailability while dependencies are down. Open http://localhost:3000.
Readiness checks require the manual staff auth columns and revocation table.

If an old local postgres/migrate container remains from the previous configuration,
stop it explicitly using its container name. The new Compose setup does not use
or delete the previous PostgreSQL volume. Do not use `down --volumes` to switch DBs.

## Initial manager on startup

Set these three values in root `.env` for Docker, or `backend/.env` for host runs:

```dotenv
INITIAL_MANAGER_EMAIL=manager@example.com
INITIAL_MANAGER_USERNAME=manager
INITIAL_MANAGER_PASSWORD=replace-with-a-private-initial-password
```

All three blank disables provisioning. On the first startup, supply all three;
the initial password must have 12-1024 characters. On subsequent starts, email
identifies the existing manager and the initial credentials are ignored. Startup checks staff_users by email without
case sensitivity. A missing account is inserted with role MANAGER and
password_change_required=true. The display name defaults to Initial Manager.
Existing manager accounts are never updated: passwords, username, active state
and the password-change flag remain exactly as stored. A conflicting non-manager
email or another account's username stops startup with a safe configuration error.
Concurrent application starts are serialized during this check.

Sign in using the configured username and initial password. The database flag
forces the password-change screen and blocks protected APIs. Successfully changing
the password stores its hash, sets password_change_required=false and invalidates
older sessions. Future logins use the changed password and open the dashboard;
restarting the application never restores the environment password.

This writes an account row only, not schema changes. The manual auth schema must
already exist. The runtime role needs INSERT on staff_users when creating the
account; grant only required privileges, not schema ownership or superuser.
After provisioning, you may clear all three variables and remove the runtime
INSERT grant. Provisioning never reactivates a disabled manager.

Recreate the backend after environment changes with `docker compose up --build -d`.
No initial credentials are hard-coded, logged or added to the gateway/frontend.

## Create a manager explicitly

After applying the supplement, this command inserts a NEW staff account and refuses
existing usernames/emails. It does not run migrations or reset existing accounts.

```powershell
$env:MAD_MANAGER_USERNAME = Read-Host 'Lowercase username'
$env:MAD_MANAGER_FULL_NAME = Read-Host 'Full name'
$env:MAD_MANAGER_EMAIL = Read-Host 'Unique email'
$securePassword = Read-Host 'Initial password (12-1024 characters)' -AsSecureString
$credential = [System.Management.Automation.PSCredential]::new($env:MAD_MANAGER_USERNAME, $securePassword)
try {
  $env:MAD_MANAGER_PASSWORD = $credential.GetNetworkCredential().Password
  docker compose run --rm --no-deps -e MAD_MANAGER_USERNAME -e MAD_MANAGER_FULL_NAME -e MAD_MANAGER_EMAIL -e MAD_MANAGER_PASSWORD mad-backend node dist/auth/provision-manager-cli.js
} finally {
  Remove-Item Env:MAD_MANAGER_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:MAD_MANAGER_USERNAME -ErrorAction SilentlyContinue
  Remove-Item Env:MAD_MANAGER_FULL_NAME -ErrorAction SilentlyContinue
  Remove-Item Env:MAD_MANAGER_EMAIL -ErrorAction SilentlyContinue
  $credential = $null
  $securePassword = $null
}
```

Sign in and change the initial password. For host development, run `npm ci`,
`npm run build` and `npm run start:dev` in backend with backend/.env configured.
Host provisioning uses `npm run manager:create` with the same manager variables.
The frontend host configuration uses BACKEND_API_URL=http://localhost:8080 and
BACKEND_API_MODE=gateway. Do not run host apps and containers on the same ports.

## Maintenance and troubleshooting

Rebuild with `docker compose up --build -d` after code changes. Recreate containers
with `docker compose up -d` after environment changes. Restart api-gateway after
editing the mounted local route file. Stop applications with `docker compose down`;
this does not alter the hosted database.

A password authentication failure now refers to the hosted database role: verify
its credentials and branch, rather than resetting a local Docker volume. TLS errors
require checking the endpoint and certificate trust; do not disable verification.
A healthy connection with readiness 503 usually means missing auth supplement
columns or insufficient permissions. Analytics 503 indicates missing reporting
views, grants or room availability data. There is no default manager password.

CI uses `deploy/compose.ci.yml` with a disposable PostgreSQL fixture and direct
frontend-to-backend routing. It does not connect to Neon or prove gateway integration.
Historical migration tests remain disposable legacy coverage, not deployment steps.
No tests, builds, live database connections or SQL execution were performed for
this change. Configuration/static checks do not establish runtime compatibility.
# Staff provisioning (DDP-012)

Manager-authorized `POST /mad/staff` creates Receptionist, Worker, Kitchen Staff
and Kitchen Manager accounts with queued SendGrid credential delivery.
Before using it, manually apply `deploy/neon-mad-staff.sql` and configure
`STAFF_CREDENTIALS_KEY`, `STAFF_EMAIL_ENABLED`, `SENDGRID_API_KEY` and
`SENDGRID_FROM_EMAIL`. See the [DDP-012 setup and operations guide](backend/DDP_012_IMPLEMENTATION.md).
The application does not apply this SQL at startup.
