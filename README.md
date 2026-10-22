# Manager Dashboard

The application runs a Next.js frontend and NestJS backend through a separate
routing-only API gateway. PostgreSQL is hosted on Neon. Each subsystem owns its
login; MAD manages manager login and mandatory initial password change.

## Local startup

1. Configure the root `.env` using `.env.example`; preserve private secrets.
2. Have the database owner review and manually run `docs/forever-hotel.sql`
   in Neon SQL Editor. Startup never changes the schema.
3. Place the separate gateway checkout in `api-gateway/`, or set
   `API_GATEWAY_CONTEXT` to its location.
4. Run `docker compose up -d --build`, then open http://localhost:3000.

The gateway defaults to port 8080 and the backend to port 4000. Inspect startup
with `docker compose logs --tail=100`. Avoid sharing resolved Compose configuration
that contains private environment values.

## Development commands

Use the Node version in `.nvmrc`. Run `npm ci` in backend and
`npm ci --ignore-scripts` in frontend. Each package provides `build`, `lint`,
`format:check` and `test:cov`. Backend integration tests use
`npm run test:integration` with a disposable `TEST_DATABASE_URL` and RabbitMQ
configuration. Never point test fixtures at the hosted development or production
database.

CI configuration remains in `.github/workflows/ci.yml`. It runs only backend and
frontend checks; automatic image publication and staging deployment are removed.
Markdown files are not runtime dependencies.

## Manual database setup

`docs/forever-hotel.sql` contains the complete supplied shared schema and all
MAD additions in one transaction. Run it manually as the schema owner after
reviewing/backing up the target database; it contains no existing Neon data.
On an empty public schema it creates the shared tables. With an existing shared
schema it skips shared-table creation and applies the MAD additions. An incomplete
shared schema stops with a missing-table message; it is not silently replaced.
Existing passwords, flags, policy values and business data are not reset. Existing
object definitions are not automatically repaired by IF NOT EXISTS. Review the
commented grants using actual restricted MAD/WKMS role names. Real room history
and other business data are not invented or seeded.

Local startup uses gateway routes embedded in `docker-compose.yml`. CI runs backend and
frontend checks, including isolated backend database integration tests. Browser
acceptance, container smoke and deployment-tool test jobs have been removed.
No automated deployment, host monitoring or backup scripts are included.

## Local gateway routes

Docker Compose supplies `configs.gateway_routes.content` from `docker-compose.yml`
as the gateway's read-only `/app/config/routes.local.json` configuration. `/mad/auth/*` is forwarded to `/auth/*` on
the MAD backend; other `/mad/*` paths retain their prefix. The destination is
`MAD_SERVICE_URL`, configured as `http://mad-backend:4000` inside Compose.
The gateway routes requests; the MAD backend owns login and JWT validation.

`docs/forever-hotel.sql` remains manual-only and is not mounted or executed by
the local Compose stack or application startup.

Inline configuration requires Docker Compose 2.23.1 or newer. There is no separate
route JSON or deploy directory to maintain. `docs/` remains Git-ignored, so keep
the full manual SQL locally; CI uses only tracked disposable SQL fixtures under
`backend/test/fixtures/` and does not depend on local docs files.
