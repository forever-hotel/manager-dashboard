# Forever Hotel — DDP foundation development

The current implementation covers DDP-001 through DDP-009. DDP is the ticket
prefix used from now on. Existing `mad_*` database names, cookie name and Compose
service names remain compatible with existing installations; this is not a data
or infrastructure rename.

DDP-009 adds the manager-only booking totals/trends API by check-in date. Provision
the booking provider's reporting view and rerun the migration permissions step as
described in the [backend README](backend/README.md#ddp-009-booking-totals-and-trends).

## Prerequisites and configuration

Use Node 22.14.x (`.nvmrc`), npm 10 or later, Docker with Compose v2 and PostgreSQL 15.
Keep the committed package-lock files and install with `npm ci`. Retain the
Next.js/React/NestJS versions already selected in the repository.

Copy example files only when creating local configuration; preserve any existing
settings. Example passwords are for isolated local development. Use externally
supplied secrets and HTTPS origins in shared environments. Database passwords in
connection URLs must be URL-encoded; the local examples use URL-safe characters.

Real login depends on the central Auth Service. Set `AUTH_SERVICE_URL`,
`JWT_ISSUER` and `JWT_SECRET` to the agreed provider configuration. No local default
manager account is created. See the [backend README](backend/README.md) for setup
and integration prerequisites.

## Run in containers

From the repository root, after creating `.env` from `.env.example`:

```powershell
docker compose up --build -d
docker compose ps
```

The stack contains four services on Compose's default network:

1. `postgres` creates a dedicated `mad_app` login on a fresh volume and keeps
   database files in the named `postgres_data` volume.
2. `migrate` waits for PostgreSQL, applies versioned migrations using owner
   credentials and exits. An advisory transaction lock serializes migration runs.
3. `mad-backend` starts after successful migration. Its readiness check queries
   the database rather than returning a static success response.
4. `mad-frontend` starts independently so it can render an unavailable page while
   the backend/database is down. Its health check remains unhealthy until the
   backend is ready.

Open `http://localhost:3000`. The backend is at `http://localhost:4000`.
Compose uses `postgres:5432` and `http://mad-backend:4000` inside its network.
The default central Auth URL `http://host.docker.internal:5000` assumes that a
separate provider runs on the host. Configure a reachable provider URL for your
environment; the provider is not supplied by this repository.

```powershell
docker compose logs mad-backend mad-frontend migrate
docker compose down
```

Normal `down` preserves the database volume. Do not add `--volumes` when retaining
local data. An existing volume will not rerun PostgreSQL initialization scripts;
changing an environment password does not rotate an existing database password.
The database owner must provision/update the runtime role for an older volume.

After a database outage, restart failed migrations/backend if necessary:

```powershell
docker compose up -d postgres
docker compose run --rm migrate
docker compose up -d mad-backend mad-frontend
```

## Run applications on the host

Create the root `.env`, `backend/.env` and `frontend/.env.local` from their examples.
Keep database passwords consistent. Host processes use `localhost:5432` and
`http://localhost:4000`; they cannot resolve Compose service names.

From the repository root:

```powershell
docker compose up -d postgres
```

In a backend terminal:

```powershell
cd backend
npm ci
npm run build
npm run migration:run
npm run start:dev
```

In a frontend terminal:

```powershell
cd frontend
npm ci
npm run dev
```

For an external PostgreSQL instance, a database administrator must create the
dedicated non-owner `mad_app` login before migration, without superuser, database
creation, role creation, replication, RLS bypass or membership privileges.
`MIGRATION_DATABASE_URL` is the separate owner connection used only by the CLI.
The application uses `DATABASE_URL` with the restricted login.

## Quality gates and current verification status

Both applications provide read-only lint and format checks, builds and unit
coverage commands. GitHub Actions runs them on every push and on PRs to develop
or main. API integration and browser jobs use disposable PostgreSQL instances and
a test-only Auth contract provider. High/critical dependency findings fail CI.
Coverage artifacts are uploaded even when another check fails.

The repository maintainer must configure required status checks/branch protection:
Backend checks, Frontend checks, Browser acceptance and Container smoke. Staging
and release deployment belong to later tickets.

No tests, builds, containers or runtime acceptance checks were run during the
implementation-only review. Real Auth integration, database ownership agreement,
hosted CI and branch protection still require confirmation before ticket sign-off.

The root `docs/` directory is reserved for local documents and is excluded from
future Git commits. Its files are not required to build or run the application.
