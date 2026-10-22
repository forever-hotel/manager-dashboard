# Manager Dashboard

The application runs a Next.js frontend and NestJS backend through a separate
routing-only API gateway. PostgreSQL is hosted on Neon. Each subsystem owns its
login; MAD manages manager login and mandatory initial password change.

## Local startup

1. Configure the root `.env` using `.env.example`; preserve private secrets.
2. Have the database owner review and manually run `deploy/forever-hotel.sql`
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

CI and staging configuration remains in `deploy/` and `.github/workflows/`.
Markdown files are not runtime dependencies.

## Manual database setup

`deploy/forever-hotel.sql` contains the complete supplied shared schema and all
MAD additions in one transaction. Run it manually as the schema owner after
reviewing/backing up the target database; it contains no existing Neon data.
On an empty public schema it creates the shared tables. With an existing shared
schema it skips shared-table creation and applies the MAD additions. An incomplete
shared schema stops with a missing-table message; it is not silently replaced.
Existing passwords, flags, policy values and business data are not reset. Existing
object definitions are not automatically repaired by IF NOT EXISTS. Review the
commented grants using actual restricted MAD/WKMS role names. Real room history
and other business data are not invented or seeded.

Local startup mounts `deploy/gateway.routes.local.json`. CI runs backend and
frontend checks, including isolated backend database integration tests. Browser
acceptance, container smoke and deployment-tool test jobs have been removed.
Retained staging/operations tools support workflows and scheduled infrastructure,
rather than local app startup.
