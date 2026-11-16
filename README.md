# Forever Hotel — Manager Dashboard (MAD)

MAD is the management application of the Forever Hotel Management System,
providing analytics, operational visibility, promotions, complaint resolution,
staff administration and worker performance reporting. It forms part of the
SENG 34213 System Development Project at the University of Kelaniya.

## Requirements and design references

This README describes the current implementation and its relationship to the
approved requirements. Requirement references do not imply that every acceptance
criterion has been independently verified in the deployed environment.

- [SRS](../documents/main/SRS_Forever%20Hotel%20Management%20System.pdf): section 4.2, Manager Dashboard requirements; section 12.1.3, interface requirements.
- [SDS](../documents/main/SDS_Forever_Hotel_Management_System.pdf): section 5.2.2, flows MAD-05 through MAD-10, shared architecture and security design.
- [Development guidelines](../documents/main/development/SENG34213_System_Development_Project.pdf): engineering practices, testing, CI/CD and evaluation requirements.
- [MAD overview](../documents/mad/README.md).
- [Shared architecture](../documents/architecture/README.md).

Links starting with `../documents` require the combined parent workspace and are
outside the standalone MAD repository.

## Functional scope and traceability

| SRS reference         | Responsibility                                                                              | Backend area                |
| --------------------- | ------------------------------------------------------------------------------------------- | --------------------------- |
| MD-01                 | Booking totals, trends and period comparisons                                               | `analytics/`                |
| MD-02                 | Occupancy and calendar visibility                                                           | `analytics/`                |
| MD-03                 | Revenue summaries and comparisons                                                           | `analytics/`                |
| MD-04                 | Low-booking alerts and promotion suggestions                                                | Analytics and notifications |
| MD-05, MD-05b, MD-05c | Promotion creation, editing, activation, deactivation, logical deletion and HW availability | `promotions/`               |
| MD-06                 | Food-order analytics                                                                        | `analytics/`                |
| MD-07                 | Kitchen order status overview                                                               | `kitchen/`                  |
| MD-08                 | Service-request totals, resolution metrics and unresolved requests                          | `analytics/`                |
| MD-09, MD-09b         | Complaint register, status changes and internal notes                                       | `complaints/`               |
| MD-10                 | Worker performance and linked complaints                                                    | `analytics/`                |
| MD-11                 | PDF and CSV report exports                                                                  | `reports/`                  |
| MD-12                 | Read-only room status board                                                                 | `rooms/`                    |
| MD-13                 | Complaint and kitchen stock notifications                                                   | `notifications/`, `stock/`  |
| MD-14, MD-15, MD-15b  | Staff creation and generated credential delivery                                            | `staff/`                    |
| MD-16b                | Staff profile, role and activation management                                               | `staff/`                    |
| MD-17                 | Read-only WMS task queue                                                                    | `tasks/`                    |

**Password administration difference:** SRS MD-16 and SDS flow MAD-07 describe a
manager-triggered staff password reset. The current implementation uses
gateway-owned password recovery and does not expose a manager reset of another
user's password. Record and review this difference through the project's ADR/SDS
maintenance process; do not claim MD-16 is implemented by the staff profile editor.

The current implementation also supports multiple staff roles and a protected
ROOT administrator. The `roles` array is the permission source; the singular
`role` column is a compatibility projection.

## Architecture and service integration

The frontend uses Next.js App Router, React, TypeScript and Tailwind CSS. Shared
visual tokens are defined in `frontend/app/globals.css`. The backend uses NestJS,
TypeORM and PostgreSQL. Use Node.js 22 and npm 10 or later within the package
`engines` constraints.

The API gateway owns staff sign-in and password recovery. MAD integrates with
central authentication and enforces manager/ROOT permissions for its operations.
The shared WebSocket server is a separate sibling service; MAD contains its
consumer and relay integration.

| System                   | Relationship with MAD                                                  |
| ------------------------ | ---------------------------------------------------------------------- |
| HW                       | Booking/payment analytics and shared promotion availability            |
| FDS                      | Shared booking/room snapshots and room change events                   |
| FOSS                     | Service-request and complaint records; authorized complaint resolution |
| KMS                      | Food-order snapshots and kitchen/stock events                          |
| WMS/WKMS                 | Read-only tasks, worker metrics and task change events                 |
| API gateway              | Central authentication and routed API requests                         |
| RabbitMQ                 | Durable operational events between backend services                    |
| Shared WebSocket service | Authorized browser notifications and invalidations                     |

Operational changes commit to PostgreSQL. Producers publish events through their
integration mechanisms; MAD consumes relevant RabbitMQ events and relays browser
invalidations through the shared WebSocket service. The frontend requests fresh,
authorized REST snapshots. PostgreSQL remains the source of business data.
MAD-owned changes can also initiate invalidations directly. REST recovery handles
socket interruptions; socket connectivity alone does not verify every event flow.

MAD does not check guests in, process guest payments, cook orders or assign and
complete worker tasks. Those writes remain with their owning services.

## Repository structure

```text
mad/
├── backend/
│   ├── src/
│   │   ├── analytics/       Booking, revenue, occupancy and performance queries
│   │   ├── auth/            Auth integration and initial administrator provisioning
│   │   ├── complaints/      Review, internal notes and resolution
│   │   ├── promotions/      Promotion rules and management
│   │   ├── staff/           Profiles, roles and credential delivery
│   │   ├── kitchen/         Kitchen order visibility
│   │   ├── tasks/           Read-only worker task queue
│   │   ├── rooms/           Room state visibility
│   │   ├── notifications/   Manager notifications
│   │   ├── stock/           Kitchen stock alerts
│   │   ├── realtime/        Broker consumers and WebSocket relay
│   │   ├── reports/         PDF/CSV generation
│   │   └── ...              Configuration, security, health and shared utilities
│   └── test/                Database integration tests and fixtures
├── frontend/
│   ├── app/                 Routes, layouts, API handlers and global styles
│   ├── components/          Reusable interface components
│   ├── lib/                 API clients, validation and application helpers
│   ├── public/              Static assets
│   ├── scripts/             Build checks and audit tooling
│   └── test/                Frontend and browser test support
├── scripts/                 Repository quality and coverage checks
├── .github/workflows/       CI, image publication and staging deployment
└── AUTOMATIC-STAGING.md     Staging configuration and release behavior
```

Backend controllers delegate validated requests to business services and database
access code. Frontend routes compose components and load validated API snapshots.
Directories such as `.next`, `dist`, `coverage` and `node_modules` are generated.

## Local setup

The parent workspace Compose stack contains all six applications, API gateway,
WebSocket service, PostgreSQL and RabbitMQ. Configure private values in the root
`.env` using its example. Never commit credentials.

For a fresh database, run from the workspace root:

```powershell
docker compose up -d --wait postgres
docker compose cp documents/FINAL_FULL_SCHEMA.sql postgres:/tmp/forever-schema.sql
docker compose exec -T postgres psql -U forever_owner -d forever -v ON_ERROR_STOP=1 -f /tmp/forever-schema.sql
docker compose up -d --build
docker compose ps
```

Stop if schema initialization fails. Existing databases require a reviewed upgrade
or migration plan. SQL is not executed by application startup.

| Local service            | URL                     |
| ------------------------ | ----------------------- |
| MAD frontend             | <http://localhost:3000> |
| MAD backend              | <http://localhost:4000> |
| API gateway              | <http://localhost:8080> |
| Shared WebSocket service | <http://localhost:8081> |

See [local PostgreSQL setup](../documents/LOCAL_POSTGRES.md) and
[authentication setup](../documents/setup/authentication.md).

For native development, run `npm ci` separately in `backend/` and `frontend/`.
Configure each package from its environment example. Run `npm run start:dev` in
the backend and `npm run dev` in the frontend, with database, gateway, broker and
shared WebSocket dependencies available.

## Configuration and database

| Setting                                                                 | Purpose                                                     |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD`, `DB_SSL` | Backend PostgreSQL connection                               |
| `INITIAL_MANAGER_EMAIL`, `INITIAL_MANAGER_USERNAME`                     | Optional initial ROOT identity                              |
| `STAFF_EMAIL_ENABLED`, `BREVO_API_KEY`, `STAFF_EMAIL_FROM`              | Staff credential email delivery                             |
| `STAFF_CREDENTIALS_KEY`                                                 | Encrypt queued credentials; preserve while deliveries exist |
| `AUTH_SERVICE_URL`                                                      | Central authentication service                              |
| `MAD_REALTIME_ENABLED`, `RABBITMQ_URL`                                  | Broker consumer enablement and connection                   |
| `SHARED_WEBSOCKET_URL`, `MAD_WEBSOCKET_RELAY_KEY`                       | Backend relay and matching service credential               |
| `LOW_BOOKING_THRESHOLD`                                                 | Low-demand alert threshold                                  |
| `BACKEND_API_URL`, `BACKEND_API_MODE`, `APP_ORIGIN`                     | Frontend server routing and origin                          |
| `MAD_SOCKET_PUBLIC_URL`                                                 | Browser-reachable shared socket origin                      |
| `GUEST_PII_ENABLED`, `GUEST_PII_REQUIRE_ENCRYPTED`, `GUEST_PII_KEY`     | Coordinated guest PII encryption rollout                    |

Use package environment examples for configuration details. Containers use service
DNS names; host-run applications use published ports. Local PostgreSQL disables
SSL; hosted Neon connections require SSL. Never expose database, relay or
encryption secrets through `NEXT_PUBLIC_*` values.

Schema synchronization and startup migrations are disabled. Apply reviewed SQL
manually as the owner. Schema files do not transfer existing business records.
Retain application encryption keys when migrating existing data.

Initial ROOT provisioning generates a random password and queues encrypted email
delivery when the configured identity is absent. Existing credentials are
preserved. There is no default administrator password. Create staff through the
application after initial setup.

## Testing and quality gates

Run from `backend/`:

```bash
npm run lint
npm run format:check
npm run build
npm run test:cov -- --runInBand
npm run test:integration
```

Run from `frontend/`:

```bash
npm run check:build-config
npm run lint
npm run format:check
npm run test:cov
npm run build
npm run test:e2e
```

Integration tests require disposable PostgreSQL and, for messaging scenarios,
RabbitMQ/shared WebSocket dependencies. Follow the workflow configuration for
`TEST_DATABASE_URL`, `TEST_RABBITMQ_URL` and `SHARED_WEBSOCKET_PATH`. Never point
tests at the hosted application database. Install Playwright Chromium before
running browser tests on a new machine.

The backend configures 80% global line/branch coverage and 90% branch coverage for
selected critical services. CI also checks changed-code coverage, dependency
vulnerabilities and cross-system authentication/realtime integration. Current CI
artifacts provide measured results; configured thresholds alone do not establish
that a release passed.

## CI/CD and deployment

[GitHub Actions](.github/workflows/ci.yml) runs backend, frontend and cross-system
checks. Eligible releases publish commit-tagged frontend/backend images to GHCR
and record immutable digest references. The staging deployment job depends on
publication and invokes the pinned shared infra action when its conditions pass.

See [automatic staging](AUTOMATIC-STAGING.md) for branch, approval, credentials and
recovery details. SQL upgrades, environment changes, routes and broker provisioning
are coordinated separately. Routine image deployment does not apply them.
Environment changes require container recreation.

Backend health endpoints are `/health/live` and `/health/ready`, with equivalent
`/mad/health/...` routes. Readiness checks selected database dependencies, not every
feature or email/broker flow.

After deployment, verify login, analytics, room visibility, promotions, complaint
resolution, staff credential delivery, task loading and a cross-system change
reaching the dashboard. Preserve deployment receipts and investigate failed checks.

## Contribution and evaluation evidence

Follow the development guidelines: short-lived feature branches, reviewed pull
requests, Conventional Commits and semantic release tags. Link issues and tests
to the relevant SRS requirement and SDS flow. Record significant design differences
through the ADR/SDS review process.

Keep acceptance criteria, tests, coverage reports, security checks and deployment
receipts as evaluation evidence. Use current artifacts and business-flow demos
rather than unverified pass counts. Document limitations, including requirement
differences and environment-specific staff access controls.
