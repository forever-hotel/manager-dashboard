# Manager Dashboard

The application runs a Next.js frontend and NestJS backend through a separate
routing-only API gateway. PostgreSQL is hosted on Neon. Each subsystem owns its
login; MAD manages manager login and mandatory initial password change.

## Local startup

1. Configure the root `.env` using `.env.example`; preserve private secrets.
2. Have the database owner review and manually apply the required shared schema
   and MAD SQL supplements in `deploy/`. Startup never changes the schema.
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
configuration. Browser tests use `npm run test:e2e` in frontend; their service
setup is configured in `frontend/playwright.config.ts`. Never point test fixtures
at the hosted development or production database.

Staging and release configuration remains in `deploy/` and `.github/workflows/`.
Markdown files are not runtime dependencies.
