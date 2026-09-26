# DDP-001–008 integration and database contracts

Date: 2026-09-26. This describes the adapter implemented in this repository.
It is not evidence of agreement or deployment by the central Auth/Gateway or
other subsystem owners. DDP-038 must reconcile it with those owners.

## Central authentication

`AUTH_SERVICE_URL` is a server-only base URL. The NestJS adapter appends the paths
below, uses a five-second timeout, refuses redirects and never logs credentials.
The central service owns passwords, password policy, staff activation and session
revocation. This repository does not create accounts or hash/store passwords.

| Request                                                                             | Required central response                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/login` with `{username, password}`                                      | `200 {accessToken}`; invalid credentials return 401                                                                                                        |
| `GET /auth/session` with bearer token                                               | `200 {active, sub, username, role, passwordChangeRequired}` for the specific current token; revoked/expired tokens return 401 or `active: false`           |
| `POST /auth/logout` with bearer token                                               | Revoke the token; return 200 JSON or 204; already-invalid tokens may return 401                                                                            |
| `POST /auth/change-password` with bearer token and `{currentPassword, newPassword}` | Apply central password policy, invalidate prior sessions, clear forced-change state and return `200 {accessToken}` with a fresh token for the same subject |

Every staff JWT must use HS256 with the configured `JWT_SECRET`, exactly match
`JWT_ISSUER`, and include a UUID `sub`, string `role`, integer `iat` and `exp`.
`iat` cannot be in the future, `exp` must be in the future and `exp - iat` must
equal 28,800 seconds. Expiry requires login again; there is no refresh-token flow.
Only MANAGER receives administrative dashboard access. Kitchen Manager partial
access requires a separately agreed route policy before later features are added.

Each protected request checks both the local token hash revocation table and
central `/auth/session`. The provider must invalidate old tokens after password
reset, deactivation or other central revocation; simply returning an active staff
profile without checking the submitted token does not satisfy this contract.

Forced-change sessions can read session status, change their password and log out.
They cannot pass the exported `JwtAuthGuard` or open dashboard pages. Password
change requires a replacement token and central confirmation before access.
Logout first stores a SHA-256 token hash locally, so provider failure cannot make
the old dashboard token usable again. A provider outage returns 503 and allows
retry. No plaintext token is persisted in PostgreSQL.

## Browser boundary and errors

The frontend BFF calls the backend/gateway via server-only `BACKEND_API_URL`.
Configure that URL with the appropriate gateway base path when deployed.
The browser uses same-origin `/api/auth/login`, `/session`, `/logout` and
`/change-password`; no bearer token is returned in browser response bodies.

State-changing BFF requests require JSON, the exact configured `APP_ORIGIN`, and
a non-cross-site Fetch Metadata value when supplied. The `mad_session` cookie
is HttpOnly, SameSite=Strict, path `/`, expires with the token and is Secure on
HTTPS. Local HTTP is allowed only for loopback production origins. Cookies cannot
outlive the token. Responses are not cached and destination redirects are limited
to the known dashboard routes.

NestJS errors use `{code, message, details?}`. Codes include `VALIDATION_ERROR`,
`UNAUTHENTICATED`, `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED` and
`SERVICE_UNAVAILABLE`. Stack traces, credential values and upstream response
bodies are not returned to the browser. The BFF additionally uses
`AUTHENTICATION_FAILED` for generic login/password-change errors.

## Database ownership and migration

The implementation currently owns `mad_promotion_codes`, `mad_revoked_sessions`
and the owner-only `mad_migrations` version register in `public`. The promotion
schema is retained under DDP-006; promotion endpoints/UI are later-ticket work.
The runtime role can read/write the first two tables but cannot alter schemas or
the migration register. Existing matching promotion records are preserved.

The migration grants read-only access to existing `bookings`, `payments`, `rooms`
and `room_types` reporting tables, if present. It does not create those tables.
The allowlist must be reconciled with provider-owned views/names in DDP-038;
rerun the migration permissions step after approved reporting objects are added.
Staff credentials and shared complaint records remain outside this service's
write boundary. No staff-password authority or shared-service schema is created.

`MAD_DB_ROLE` must be a dedicated non-owner login without privileged flags or
role memberships. The runner rejects unsafe principals and effective shared-table
write privileges, including PUBLIC/column grants that ordinary table revocation
would miss. A shared database with such grants requires administrator remediation;
the runner does not silently rewrite another subsystem's PUBLIC table privileges.
The migration revokes PUBLIC schema creation and restricts this role's table and
sequence grants in `public`.

Run `npm run build` then `npm run migration:run` in `backend`. The CLI reads
`MIGRATION_DATABASE_URL` and `MAD_DB_ROLE`. The normal API reads `DATABASE_URL`
and never runs with migration credentials. The Compose initialization script
creates `mad_app` only on a fresh volume.

All version application and permission changes run in one transaction under
`pg_advisory_xact_lock(1789600000)`. Repeated execution skips recorded versions;
concurrent executions serialize. Add future forward migrations to the ordered
registry in `src/database/migrate.ts`. Never edit an applied version in a deployed
database. A previously applied foundation version still receives the runner's
updated permission checks on rerun.

The supported adoption path is the existing `mad_promotion_codes` schema. An
unprefixed `promotion_codes` table causes first migration to stop rather than
silently creating a disconnected replacement or moving records across ownership
boundaries. DDP-038 must authorize a dedicated data migration for that installation.
Incompatible existing constraints/data also cause the transaction to roll back.

Before a shared-environment migration, take a database-owner backup. A failed
transaction rolls back its changes. Recovery after a committed change uses a
reviewed forward migration or restoration to a separate database and controlled
connection cutover. Automatic destructive `down` is deliberately unavailable.
Application rollback must use a schema-compatible version; never remove persisted
promotion/revocation data simply to match older code.

## Required external acceptance

- Auth/Gateway owner confirms these paths, payloads, token rules and invalidation
  semantics and supplies the real endpoint/signing configuration.
- Database owners confirm the ownership/reporting allowlist and any legacy mapping.
- Repository maintainer configures required checks and branch protection.
- Runtime, browser, database persistence, CI and provider integration evidence is
  collected later. The current pass was source review only, with no test execution.
