# Clean-checkout setup and maintenance — DDP-037

Reviewed against current configuration on 2026-10-21. This is a source-checked
runbook; a clean-checkout reviewer execution is still pending. No tests or hosted
SQL were run while writing it. [API reference](API_CONTRACT.md),
[requirement traceability](REQUIREMENT_TRACEABILITY.md),
[security review](SECURITY_REVIEW.md), [Sprint 6 gate](SPRINT_6_READINESS.md).

## Prerequisites and separate repository

Use Node from root `.nvmrc` (22.x; package engines require >=22.14 <23), npm>=10,
Docker Engine/Compose v2, access to a development Neon database with the current
shared schema, and its schema owner's help for manual prerequisites/grants.
`docs/` and `api-gateway/` are ignored and therefore absent in a clean checkout.
Tracked setup/API references live here; historical SRS/SDS/SQL evidence must be
handed over separately. Do not assume a clone includes the gateway.

From the repository root, obtain the separate gateway repository:

```powershell
git clone https://github.com/forever-hotel/api-gateway.git api-gateway
```

If your team uses another remote or an existing checkout, obtain its approved
URL from the owner or set API_GATEWAY_CONTEXT to its directory. The required
Docker build context must contain the gateway Dockerfile. Compose supplies MAD
route configuration through [gateway.routes.local.json](../deploy/gateway.routes.local.json).
MAD_SERVICE_URL is injected as the internal backend origin; no Auth service is
needed. Do not commit/copy its nested Git repository into MAD. Verify the gateway
revision with its owner; this runbook does not assert a cross-repo release SHA.

## Local Compose application

Run these commands from the root (PowerShell):

```powershell
# On first setup only; never overwrite an existing private .env.
if (!(Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
```

Edit `.env` privately. One assignment per line, no Markdown links or HTML space
entities. Required DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME must identify
the approved Neon branch/runtime role. Keep DB_SSL=true, DB_SYNCHRONIZE=false,
DB_LOGGING=false. Set a private random JWT_SECRET (>=32 characters) and JWT_ISSUER.
Never use the example signing secret in shared deployments.

Optional seed: set INITIAL_MANAGER_EMAIL, INITIAL_MANAGER_USERNAME and
INITIAL_MANAGER_PASSWORD together. Password12..1024 non-whitespace characters.
Startup serializes the email check and creates one active MANAGER only if absent.
An existing matching manager is unchanged, including password/flags/username.
A conflicting non-manager identity fails startup. First login requires password
change before dashboard access; subsequent logins use the changed password.
Clearing/changing seed env variables does not reset existing database accounts.

Staff create/reset requires STAFF*CREDENTIALS_KEY even if email delivery is off.
Generate base64 of32 random bytes privately, retain it while encrypted deliveries
exist, and never prefix secrets with NEXT_PUBLIC*. For actual email set
STAFF_EMAIL_ENABLED=true, SENDGRID_API_KEY (restricted Mail Send access) and a
verified SENDGRID_FROM_EMAIL. Disabled delivery leaves encrypted work queued;
it does not make staff credentials available in an API response.

```powershell
# Generate into the terminal only when you can store it privately; do not share output.
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"
```

Apply/reconcile the **manual schema prerequisites below before startup**. Then:

```powershell
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 mad-backend api-gateway mad-frontend
```

Do not print `docker compose config` without `--quiet`: resolved values contain
secrets. Default browser UI http://localhost:3000, REST gateway8080, direct
backend4000, local RabbitMQ127.0.0.1:5672. PostgreSQL is hosted; this Compose has
no database/migration service. Root `.env` supplies Compose interpolation; it does
not automatically load backend/.env or frontend/.env.local into containers.
Compose explicitly wires server-side frontend REST to `http://api-gateway:8080`.

MAD_REALTIME_ENABLED is true in Compose; the broker service starts separately.
RABBITMQ_PASSWORD and the password embedded in RABBITMQ_URL must agree (URL-encode
the latter). Compose URL uses hostname `mad-rabbitmq`; host-run URL uses localhost.
MAD_SOCKET_PUBLIC_URL defaults http://localhost:4000: it must be browser-reachable,
not an internal container hostname. If changing ports/origins, align FRONTEND_URL,
APP_ORIGIN, public REST URL and socket URL. An HTTPS browser needs HTTPS/WSS.

Log in with the seeded username/password (not necessarily the email). Complete
password change, then inspect the feature pages. Browser login/logout/password
changes go through the same-origin BFF, not a centralized Auth service.

```powershell
# Health checks do not validate all feature tables/integrations.
Invoke-RestMethod http://localhost:4000/health/ready
Invoke-RestMethod http://localhost:3000/api/health
# Stop containers while retaining the broker volume.
docker compose down
```

Do not add `--volumes` unless deliberately resetting a disposable local broker.
Rebuild/recreate after changing env: restarting an existing container alone does
not apply changed Compose environment values.

## Host-run backend and frontend

From root:

```powershell
if (!(Test-Path -LiteralPath backend/.env)) { Copy-Item backend/.env.example backend/.env }
if (!(Test-Path -LiteralPath frontend/.env.local)) { Copy-Item frontend/.env.example frontend/.env.local }
```

Configure backend/.env with its Neon/auth/seed/staff settings. Set
MAD_REALTIME_ENABLED=false until the broker and event supplements exist, or use
true with host-reachable RABBITMQ_URL. Root `.env` is not loaded by a host backend.

In terminal1 (`backend/`):

```powershell
npm ci
npm run build
npm run start:dev
```

For a host frontend connecting directly, frontend/.env.local must set
BACKEND_API_URL=http://localhost:4000, BACKEND_API_MODE=direct,
NEXT_PUBLIC_API_URL=http://localhost:4000, APP_ORIGIN=http://localhost:3000,
MAD_SOCKET_PUBLIC_URL=http://localhost:4000. To use the gateway instead, start its
own dev server following its README, use port8080 and BACKEND_API_MODE=gateway.
Do not use port4000 with gateway mode: `/mad/auth` rewrites will be wrong.
Email/JWT/database secrets belong only to backend config, not this frontend file.

In terminal2 (`frontend/`):

```powershell
node scripts/verify-build-config.mjs
npm ci --ignore-scripts
node scripts/verify-build-config.mjs
npm run dev
```

Production-style host builds: backend `npm run build` then `npm run start:prod`;
frontend `npm run build` then `npm start`. Configure HTTPS origins when deploying.
Current local Compose is for development, not a production deployment template.

## Manual database prerequisites (no automatic migrations)

DDP-040 publication additionally requires
`deploy/neon-mad-promotion-publication.sql` after the lifecycle supplement and
reviewed outbox SELECT/UPDATE grants. Enable MAD_PROMOTIONS_PUBLISH_ENABLED only
after HW's durable queue/bindings and the proposed consumer contract are ready.
See [promotion sync guide](PROMOTION_SYNC_GUIDE.md). It defaults false; no frontend
configuration change is needed. Broker confirmation does not prove HW checkout.

The database owner must compare the actual Neon schema first; do not blindly
reapply a friend's old full schema or run every SQL file alphabetically. Use a
backup/change window for shared data. Current shared tables must include staff,
rooms/types, bookings/payments, FOSS service requests/complaints, KMS orders/items/
menu and WKMS tasks with the columns referenced in the SQL/services. The separate
shared schema is not supplied by application migrations.

| Order/group | Tracked manual SQL                                                                                                    | Purpose                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1           | `deploy/neon-mad-auth.sql`                                                                                            | Session revocation, lockout, first-login/session fields on shared staff                 |
| 2           | `deploy/neon-mad-supplement.sql`                                                                                      | Booking/occupancy reporting views and explicit room availability/maintenance history    |
| 3           | `deploy/neon-mad-staff.sql`                                                                                           | Encrypted delivery queue/index; resolve case-insensitive duplicate email first          |
| 4           | `deploy/neon-mad-promotions.sql`, then `deploy/neon-mad-promotion-lifecycle.sql`                                      | Promotion associations, version/deletion/outbox prerequisites                           |
| 5           | `deploy/neon-mad-complaints.sql`                                                                                      | MAD complaint state/history/outbox and reviewed source-field grants                     |
| 6           | `deploy/neon-mad-food-analytics.sql`, `deploy/neon-mad-service-analytics.sql`, `deploy/neon-mad-worker-analytics.sql` | Optional commented grant templates, not executable schema migrations                    |
| 7           | `deploy/neon-mad-realtime.sql`, `deploy/neon-mad-rooms.sql`, `deploy/neon-mad-tasks.sql`, `deploy/neon-mad-stock.sql` | Independent MAD event/inbox/outbox/version stores; require corresponding shared sources |
| Audit only  | `deploy/security-role-audit.sql`                                                                                      | Read-only inspection as runtime role, not owner                                         |

Paths above are relative to root. Review file headers and existing objects, apply
only necessary changes manually in the Neon SQL editor or your approved database
tool, and record applied revisions. Commented grants require substituting the
real restricted role; executing the file does not automatically apply comments.
No application/Compose command runs these SQL files or enables synchronization.
Do not run `ci-schema.sql`, browser fixtures or legacy test migrations in Neon.

Use a dedicated runtime role, not the Neon owner. It needs documented source
SELECT grants, authorized staff/complaint column updates, and MAD-owned table
rights. It should not own or write KMS/WKMS/room sources. Seed manager creation
needs reviewed INSERT privileges on staff_users. DB_SSL verifies the certificate.
Keep DB_LOGGING=false in every environment; validation rejects parameter logging.

### Seed and sample data

Startup seeds only the optional initial manager, never fake hotel metrics. Shared
source test data must be created by its owning team in a development branch.
Room occupancy needs true active_from/active_to and maintenance date ranges in
MAD's history tables; absence is not permission to assume every room was active
forever. No historical records are invented. Use the owners' transactional outbox
publishers for live events. The local test fixture SQL is isolated to disposable
test databases and is not a development/production dataset installer.

## Tests and CI (commands for the developer; not run for DDP-037)

Backend directory:

```powershell
npm run lint
npm run format:check
npm run build
npm run test:cov -- --runInBand
npm audit --audit-level=high
```

API integration needs a **disposable local PostgreSQL cluster**, not Neon. Tests
create/drop randomly named databases and runtime roles, so the test administrator
needs CREATEDB/CREATEROLE and appropriate cleanup rights. Database name must
contain `test`. Event suites also need a disposable RabbitMQ vhost and user with
configure/read/write rights (RabbitMQ4.x for stock quorum queues). For a fresh
local test environment, these test-only containers use separate ports from the
application broker. Ensure the names/ports are unused first; never replace a
shared container with these fixtures:

```powershell
docker run -d --name mad-test-postgres -e POSTGRES_PASSWORD=integration-only -e POSTGRES_DB=mad_test -p 127.0.0.1:55432:5432 postgres:15-alpine
docker run -d --name mad-test-rabbitmq -e RABBITMQ_DEFAULT_USER=mad -e RABBITMQ_DEFAULT_PASS=integration-only -e RABBITMQ_DEFAULT_VHOST=mad_test -p 127.0.0.1:55672:5672 rabbitmq:4-alpine
docker exec mad-test-postgres pg_isready -U postgres -d mad_test
docker exec mad-test-rabbitmq rabbitmq-diagnostics -q ping
```

Wait until both diagnostics succeed before testing. On subsequent runs start
these existing test containers with `docker start` instead of repeating `run`.
Configure both test URLs in the terminal running the tests:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:integration-only@localhost:55432/mad_test'
$env:TEST_RABBITMQ_URL = 'amqp://mad:integration-only@localhost:55672/mad_test'
npm run test:integration
```

These are test-only example credentials, not an instruction to change Neon. The
URLs must match services you actually provision. CI provisions these services in
`.github/workflows/ci.yml`; plain local Compose supplies Neon and is insufficient
by itself for the test harness. Integration tests apply their own fixture SQL.
Legacy migration functions exist only for legacy disposable acceptance fixtures;
there is no production migrate CLI or command to run at application startup.

Frontend directory:

```powershell
node scripts/verify-build-config.mjs
npm run lint
npm run format:check
npm run test:cov
npm run build
npm run audit:ci
npm run test:build-config
```

Browser acceptance requires dependencies installed in both directories and the
disposable TEST_DATABASE_URL in the frontend command's environment. Install the
browser once, then run:

```powershell
npx playwright install chromium
# In this terminal too, point at the disposable PostgreSQL service above.
$env:TEST_DATABASE_URL = 'postgresql://postgres:integration-only@localhost:55432/mad_test'
npm run test:e2e
```

Linux CI uses `npx playwright install --with-deps chromium`. Playwright starts
its own backend4401 and frontend3301, creates `mad_browser_test_*` databases and
cleans up. Keep these ports free; it does not reuse existing dev servers.
Current suites cover auth and reports, not full real-provider acceptance. CI
requires backend/frontend >=80% lines/branches and critical configured logic

> =90% branches. CI additionally compares LCOV-covered changed lines/branches with
> the push's previous SHA or PR base SHA (80%, critical branches90%). The JSON report
> includes both SHAs and is uploaded with coverage. Actual measured evidence is
> still required; configured thresholds are not a passing result.
> The audit exception and its expiry are documented in [security review](SECURITY_REVIEW.md).

After generating coverage yourself, the same check can be run from the applicable
backend/frontend directory. Set `COVERAGE_BASE_SHA` to the full reviewed comparison
commit, then run `node ../scripts/check-changed-coverage.mjs backend` (or `frontend`).
Coverage scope follows existing Jest/Vitest instrumentation. Changed executable
lines and branches with LCOV records are measured; pure comments/type-only changes
have no executable denominator. Startup/page wrappers and external service code
outside that scope require separate review and integration evidence. Missing LCOV
or invalid comparison revisions fail the check. New branches compare against the
empty tree when GitHub supplies an all-zero previous SHA. Workflow checkouts fetch
history so normal push and PR comparison commits are available.

For a basic isolated container smoke fixture, CI uses:

```powershell
docker compose --env-file .env.example -f docker-compose.yml -f deploy/compose.ci.yml -p mad-ci up --build --wait --wait-timeout 180 postgres mad-backend mad-frontend
```

This is only a liveness/login fixture, not the whole schema or full integration
environment. It deliberately omits the gateway and uses a disposable DB. Do not
copy its database/privileges into Neon. Clean its disposable volumes only when
finished; never reuse that cleanup command on a shared project.

## Troubleshooting and maintenance

- Backend unhealthy: inspect readiness logs' fixed dependency/SQLSTATE, verify
  auth SQL and runtime grants, Neon branch/SSL/network. Do not paste DATABASE_URL.
- Healthy backend but feature503: check that feature's views/source columns/grants;
  readiness tests only auth prerequisites. Empty data and outages are different.
- Login403/password prompt: finish first login. Existing manager seed env never
  overwrites DB credentials. Session version/activation/role changes require login.
- Email pending/failed: verify key retention, enabled flag, verified sender and
  provider permission/network. Re-enable delivery/retry; avoid repeated resets,
  which invalidate already-issued temporary passwords.
- Live unavailable: verify manual event SQL, broker credentials/vhost/queue types,
  producer adoption, source versions, direct socket origin and reverse-proxy
  upgrade support. Do not purge queues to repair declarations. Single MAD only.
- Integrity failure: review actual config diff against the pinned manifest;
  never regenerate all hashes to bypass a warning.

Update API/event docs, requirement links, tests and manual SQL notes with each
contract change. Coordinate source ownership, publish only after commit, use
actual event/correlation IDs for troubleshooting, and retain redacted CI/staging
evidence. Do not claim DDP-040 publication, DDP-043 notifications, DDP-045 task
limits or final DDP-046 integration acceptance when their implementation/evidence
is absent. The setup reviewer must still execute this runbook on a clean checkout
and record SHA, tool versions, commands/results and evidence before AC2 closes.
