# Manager dashboard: architecture and local development

This guide covers the manager frontend, manager backend, shared API gateway and
PostgreSQL in this workspace. The root Compose file runs these together for local
development. Other hotel subsystems remain separate applications.

## Components and request flow

| Component | Responsibility | Local address |
| --- | --- | --- |
| Next.js manager frontend | Pages, browser session cookie and server-side API calls | http://localhost:3000 |
| Fastify API gateway | Routing, cookie transport, CORS, rate limits and timeouts | http://localhost:8080 |
| NestJS MAD backend | Manager login, JWT/session validation, permissions and analytics APIs | http://localhost:4000 |
| PostgreSQL | Manager accounts, revocations, MAD data and available reporting views | localhost:5432 |
| Migration job | Applies schema changes using a separate owner connection, then exits | No HTTP port |

Browser requests go to the Next.js frontend. Its backend-for-frontend (BFF)
calls the gateway at `http://api-gateway:8080` inside Docker. The gateway forwards
MAD requests to `http://mad-backend:4000`; the backend accesses `postgres:5432`.
These are Compose service names, not host-machine addresses.

The public backend port is available for local debugging. Ports are bound to
127.0.0.1. This Compose file is a local development setup, without production TLS.

| Operation | Frontend/BFF call | Gateway forwards to MAD |
| --- | --- | --- |
| Login | /mad/auth/login | /auth/login |
| Session | /mad/auth/session | /auth/session |
| Password change | /mad/auth/change-password | /auth/change-password |
| Logout | /mad/auth/logout | /auth/logout |
| MAD readiness | /mad/health/ready | /mad/health/ready |
| Booking totals | /mad/analytics/bookings | Same path and query |
| Occupancy data | /mad/analytics/occupancy | Same path and query |

Browser authentication URLs stay on the frontend at `/api/auth/*`.
The server transport adapter performs the gateway path mapping.

## Authentication

MAD authenticates managers locally. There is no central Auth service, Redis or
shared login implementation. The gateway does not generate or verify JWTs.

Manager accounts are stored in `mad_manager_accounts`. Passwords use salted
scrypt. MAD issues eight-hour HS256 tokens with audience `mad`, a unique token ID
and account version. Every protected request checks the current account and
logout revocations. Password changes invalidate all older account sessions.
New accounts must change their initial password before accessing protected data.
Five failed password attempts lock an account for 15 minutes.

The BFF stores the token in an HttpOnly `mad_session` browser cookie at Path=/,
with SameSite=Strict and Secure when using HTTPS. It forwards the token through
the gateway in the Authorization header. Browser JavaScript receives only public
session fields. The BFF's origin checks protect browser writes.

The gateway also supports subsystem cookies, but this dashboard currently uses
the BFF-owned cookie/bearer pattern. MAD's backend auth endpoints require bearer
tokens; gateway cookie support does not automatically change that contract.

## Prerequisites

- Docker Desktop or Docker Engine with Compose v2.
- Gateway source at `./api-gateway`, or a separate checkout selected by
  `API_GATEWAY_CONTEXT`.
- Internet access for the first image builds and npm dependency downloads.
- Available host ports 3000, 4000, 8080 and 5432, or customized port settings.

Host Node/npm are not required for the all-container setup.
The gateway folder is currently ignored by this repository. A clean clone of the
dashboard therefore needs the gateway source supplied separately before building.
Its handoff instructions are in `api-gateway/DEVELOPER_GUIDE.md`.

## Configure the local stack

From the repository root, copy the example only if a private configuration does
not already exist:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Review these root environment variables:

| Variable | Example | Meaning |
| --- | --- | --- |
| API_GATEWAY_CONTEXT | ./api-gateway | Gateway source/build-context directory |
| GATEWAY_PORT | 8080 | Host gateway port |
| FRONTEND_PORT | 3000 | Host frontend port |
| BACKEND_PORT | 4000 | Host MAD debugging port |
| POSTGRES_PORT | 5432 | Host PostgreSQL port |
| POSTGRES_PASSWORD | Local example in .env.example | Database owner password |
| MAD_DB_PASSWORD | Local example in .env.example | Restricted runtime database password |
| JWT_SECRET | A dedicated secret of at least 32 characters | MAD signing key; never given to gateway |
| JWT_ISSUER | mad | MAD token issuer |
| APP_ORIGIN | http://localhost:3000 | Browser origin and gateway allowed origin |
| FRONTEND_URL | http://localhost:3000 | Backend CORS origin |
| NEXT_PUBLIC_API_URL | http://localhost:8080 | Public gateway URL embedded during frontend build |

Use URL-safe database passwords in these Compose connection strings, or adapt
the connection configuration to percent-encode special characters.
Example secrets are intended only for isolated local development.

If changing FRONTEND_PORT, also update APP_ORIGIN and FRONTEND_URL.
If changing GATEWAY_PORT, update NEXT_PUBLIC_API_URL. Internal container ports
remain 3000, 4000 and 8080, so the service-to-service URLs do not change.

An existing root `.env` may contain obsolete AUTH_SERVICE_URL, BACKEND_API_URL
or BACKEND_API_MODE entries. The root Compose stack now fixes its frontend to
the internal gateway in gateway mode; these old root settings are not used.
Remove AUTH_SERVICE_URL and set JWT_ISSUER=mad when updating the configuration.
Do not copy this signing secret into the gateway's environment.

The root stack gets its gateway settings directly from Compose. It does not
require or read `api-gateway/.env`.

## Start everything

```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps --all
docker compose logs -f mad-backend api-gateway mad-frontend
```

Startup order is PostgreSQL readiness, successful migration, MAD backend readiness,
then gateway startup. The frontend starts independently and can show an outage
page while its dependencies become ready. Its health check goes through the
gateway to MAD. The migration container exiting with code 0 is expected.

Open **http://localhost:3000**. A new database has no manager account yet.

The root stack mounts `deploy/gateway.routes.local.json` read-only into the
gateway. It enables only MAD's routes because the other subsystem backends are
not part of this repository. The gateway's standalone `config/routes.json`
still contains all six enabled subsystems for the other developers.

Do not run the standalone gateway Compose stack on port 8080 at the same time
as this root stack. Use one gateway for this local setup.

## Provision the first manager

After the migration job has completed, run this from the repository root in
PowerShell. It prompts for the password instead of writing it in shell history:

```powershell
$env:MAD_MANAGER_USERNAME = Read-Host 'Manager username'
$initialPassword = Read-Host 'Initial password (12 to 1024 characters)' -AsSecureString
$managerCredential = [System.Management.Automation.PSCredential]::new($env:MAD_MANAGER_USERNAME, $initialPassword)
try {
  $env:MAD_MANAGER_PASSWORD = $managerCredential.GetNetworkCredential().Password
  docker compose run --rm -e MAD_MANAGER_USERNAME -e MAD_MANAGER_PASSWORD migrate node dist/auth/provision-manager-cli.js
} finally {
  Remove-Item Env:MAD_MANAGER_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:MAD_MANAGER_USERNAME -ErrorAction SilentlyContinue
  $managerCredential = $null
  $initialPassword = $null
}
```

The migration service provides the owner database connection. The command
inserts a new manager and refuses duplicate usernames; it never silently resets
an existing account. Usernames are trimmed and stored lowercase.
No manager is seeded by normal application startup.

Sign in through the frontend and choose a different password when prompted.
The provisioning password exists temporarily in the process/container environment;
it is not printed or committed. Protect access to the local Docker daemon.

For host-run tooling, the same account creation command is
`npm run manager:create` from `backend` after a build, with the same manager
environment variables and MIGRATION_DATABASE_URL configured in backend/.env.

## Database and application scope

Migration 001 supplies MAD's promotion foundation and session revocations.
Migration 002 adds local manager accounts. Migrations run with owner credentials.
The runtime login is a dedicated non-owner role with restricted privileges;
manager account insertion is reserved for provisioning.

DDP-009 and DDP-010 supply booking totals/trends and occupancy calendar APIs.
Their external reporting views must be provided by the owners of booking and
room data; see `backend/README.md` for the exact view contracts.
An empty new database does not contain sample hotel data or those external views.
Missing views produce a service-unavailable response, not fabricated analytics.
Later frontend screens remain subject to their own tickets.

The PostgreSQL initialization script creates the runtime role only on a fresh
database volume. Existing installations require owner-led role/password updates.
Changing .env passwords does not rotate an already-created PostgreSQL role.

## Daily development

The Compose services run built images. Source changes require a rebuild:

```powershell
docker compose up --build -d
```

For a new backend migration, build first and explicitly run the migration job
before restarting the services that need the new schema:

```powershell
docker compose build migrate mad-backend
docker compose run --rm migrate
docker compose up -d mad-backend api-gateway mad-frontend
```

Route-file changes require restarting the gateway:

```powershell
docker compose restart api-gateway
```

Environment changes require `docker compose up -d` to recreate affected
containers. Changing NEXT_PUBLIC_API_URL requires rebuilding the frontend.
Use `docker compose down` to stop the stack while preserving database data.
Do not add `--volumes` unless intentionally discarding that database.

For hot reload, run the relevant application on the host using its README and
stop its container to free the port. A host frontend uses
BACKEND_API_URL=http://localhost:8080 and BACKEND_API_MODE=gateway.
If MAD runs on the host instead, the gateway container must target
host.docker.internal with a host-gateway mapping on Linux; that is a separate
topology from the all-container defaults.

## Troubleshooting and verification

| Symptom | Check |
| --- | --- |
| Gateway build context missing | Supply its repository or set API_GATEWAY_CONTEXT |
| Port already used | Stop the competing stack or adjust the host port and public URLs |
| Migration exits nonzero | Owner credentials, runtime role privileges and existing schema |
| Login rejected on a fresh database | Provision a manager; there is no default account |
| Login temporarily rejected after wrong passwords | Wait for the 15-minute account lockout |
| Frontend unavailable | Gateway health, MAD readiness, migration and database logs |
| Analytics returns 503 | Required external reporting views and read grants |
| Gateway 404 | Local route file and backend endpoint path |
| Cookie disappears on HTTP/HTTPS changes | APP_ORIGIN and browser cookie security settings |
| Healthy process but failed readiness | /health/live checks the process; /health/ready checks dependencies |

Manual readiness endpoints are http://localhost:8080/health/ready,
http://localhost:8080/mad/health/ready and http://localhost:3000/api/health.
These checks do not establish authentication or analytics correctness.

Tests were not run during this work. The Compose configuration was checked
without starting containers. Images, migrations, account provisioning and live
gateway login still require execution in your environment.
Backend and frontend test commands are in their package.json files.

The dashboard CI smoke job uses `deploy/compose.ci.yml` and starts only the
dashboard services in explicit direct mode, since the gateway source has its
own repository. That job does not prove integration with the gateway.
