# Forever Hotel backend — DDP-001–008

NestJS API foundation with validated configuration, health/readiness, central
authentication, manager authorization and versioned PostgreSQL migrations.
Analytics, staff provisioning and other later-ticket APIs are not implemented here.

Use Node 22.14.x (see `../.nvmrc`) and npm 10 or later. From this directory:

```powershell
Copy-Item .env.example .env
npm ci
npm run build
npm run migration:run
npm run start:dev
```

First provision the database and restricted `mad_app` role using the
[local development guide](../local_development_guide.md). Set the central Auth
provider URL, issuer and shared signing key before signing in. There are no local
manager credentials or production authentication stubs.

| Command                               | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `npm run build`                       | Compile application TypeScript                           |
| `npm run start:dev`                   | Start with file watching                                 |
| `npm run start:prod`                  | Start the compiled API                                   |
| `npm run migration:run`               | Apply missing migrations with separate owner credentials |
| `npm run lint`                        | Read-only lint; warnings fail                            |
| `npm run format:check`                | Read-only formatting check                               |
| `npm run format` / `npm run lint:fix` | Explicit formatting/lint edits                           |
| `npm run test:cov`                    | Unit coverage with enforced thresholds                   |
| `npm run test:integration`            | Disposable PostgreSQL integration suite                  |

The integration suite requires `TEST_DATABASE_URL` pointing to a disposable test
database and an account allowed to create/drop test databases and test roles.
It does not use `DATABASE_URL`. `test:serve` is a test-only browser fixture.

`GET /health/live` reports process liveness; `GET /health/ready` requires access
to the migrated database. Database loss prevents readiness. Protected requests
fail closed when authentication or database checks cannot complete.

See [the integration contract](../docs/implementation/ddp_foundation_contracts.md)
for the authentication API, schema boundary and recovery procedure.
