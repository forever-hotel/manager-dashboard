# Forever Hotel manager dashboard

Local Docker Compose runs the Next.js frontend, NestJS backend and shared API
gateway. PostgreSQL is hosted on Neon. Each subsystem owns its login; the gateway
routes requests.

1. Configure root `.env` using `.env.example`. Keep existing secrets private.
2. Ensure the shared schema and MAD supplements in `deploy/` are already installed.
   Schema changes are manual; application startup never runs migrations.
3. Keep the standalone gateway in `api-gateway/` or set `API_GATEWAY_CONTEXT`.
4. Run `docker compose up -d --build` and open http://localhost:3000.

The gateway listens on port 8080 and the backend on port 4000 by default.
Use `docker compose logs --tail=100` to inspect startup failures without printing
the resolved Compose environment.

Application, build, test, CI, deployment and security-check files are retained.
Detailed guides and historical reports are organized in local `docs/`:

- `guides/`: application and component references
- `implementation/`: ticket implementation reports
- `testing/`: test register
- `reviews/`, `history/`, `schema-review/`, `security/`: audits and evidence

`docs/` and the standalone `api-gateway/` remain ignored by this repository.
Their local content must be handed over separately when needed.

Room/task setup, read-only ownership and the WKMS event contract are documented in
[the operations guide](backend/OPERATIONS_GUIDE.md). DDP-028/DDP-042 require the
manual task supplement in `deploy/neon-mad-tasks.sql`; no automatic migrations run.

Staff account UI, delivery status and directory API details: [staff management guide](backend/STAFF_UI_GUIDE.md).
