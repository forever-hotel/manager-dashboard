# DDP-035 security review

Review date: 2026-10-21. Scope: manager dashboard backend, frontend BFF,
exports, authenticated sockets and deployment controls. References: NFR-10/12/13,
SDS section 6. Implementation and regression coverage are prepared; **final
acceptance is pending CI and staging evidence**, including DDP-046 and DDP-054.
No tests, hosted SQL, penetration tests or Neon permission queries were executed
locally. This report is not a claim that production has been penetration tested.

Local static evidence: backend and frontend TypeScript checks, targeted ESLint
and Prettier checks, backend Nest build, frontend build-config integrity and
`git diff --check` passed. The static quality-gate verifier also passed.
Frontend production build, unit/integration/browser tests and coverage were not
run in this task. Git tracks environment examples, not the root/backend/frontend
`.env` files; this filename check is not a historical secret scan.

## Changes from this review

- Server errors now redact custom error codes as well as messages/details. A
  custom 503 code containing connection details previously escaped redaction.
- Backend responses send no-store, nosniff, frame denial and no-referrer headers.
- Frontend pages and BFF responses get nosniff, frame denial, no-referrer,
  disabled camera/microphone/geolocation, and CSP restrictions on framing,
  objects and base URLs. The Next.js identification header is disabled.
  Existing HTML/CSS and login behavior are unchanged. This is deliberately a
  partial CSP: it does not claim to prevent all script injection. A strict
  nonce-based script policy needs separate Next.js rendering/browser verification.
- Production startup rejects DB_LOGGING=true, preventing query-parameter logging
  from exposing passwords, encrypted credential payloads or internal notes.
- New cross-controller HTTP boundary tests use real JWT verification, AuthService
  and JwtAuthGuard with isolated storage. Existing feature integration suites
  exercise the database; these boundary tests do not replace them.
- Read-only manual role inspection is available in
  [security-role-audit.sql](../deploy/security-role-audit.sql). It changes nothing
  and must be run using the application role, not the Neon owner.

## REST and socket inventory

Every `/mad/` route below uses the controller-level JwtAuthGuard. It validates
signature/HS256, issuer, audience, subject/JTI, exact eight-hour lifetime, expiry,
database account state, session version, revocation, MANAGER role and mandatory
password-change state. A valid disallowed role is 403; invalid/expired/revoked
sessions are 401. Unauthorized callers are rejected before ID parsing or reads.

| Surface         | Routes/actions                                                                                                                                       | Authorization/data restrictions                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication  | POST `/auth/login`, GET `/auth/session`, POST `/auth/logout`, POST `/auth/change-password`                                                           | Login is public; others require bearer sessions. Session/password change allow the first-login flow; dashboard guard does not. Logout revokes the token. |
| Health          | GET `/health/live`, `/health/ready` and `/mad/health/live`, `/mad/health/ready`                                                                      | Intentionally public; fixed service/readiness summaries, generic failures.                                                                               |
| Analytics       | GET `/mad/analytics/{bookings,revenue,overview,occupancy,low-booking-alerts,food-orders,service-requests,worker-performance}`                        | Manager-only; validated periods, dates and worker UUID; aggregate responses.                                                                             |
| Staff           | GET/POST `/mad/staff`, GET/PATCH `/mad/staff/:id`, POST `/mad/staff/:id/reset-password`                                                              | Manager-only; manager accounts excluded from staff directory/mutations; safe projections, version checks; no credential return.                          |
| Promotions      | GET/POST `/mad/promotions`, GET `/mad/promotions/room-types`, GET/PUT/DELETE `/mad/promotions/:id`, POST `/mad/promotions/:id/{activate,deactivate}` | Manager-only; UUID and allowlisted DTOs; versioned mutations, logical deletion, atomic outbox.                                                           |
| Complaints      | GET `/mad/complaints`, GET/PATCH `/mad/complaints/:id`                                                                                               | Manager-only; validated UUID/filter/version/transitions; internal notes stay in manager-authorized detail/history.                                       |
| Rooms           | GET `/mad/rooms/status`                                                                                                                              | Manager-only, read-only snapshot.                                                                                                                        |
| Kitchen         | GET `/mad/kitchen/orders`                                                                                                                            | Manager-only, read-only snapshot.                                                                                                                        |
| Tasks           | GET `/mad/tasks`; all methods `/mad/tasks/:id/{claim,assign,complete}`                                                                               | Manager-only read; task mutations explicitly forbidden, ownership stays WKMS.                                                                            |
| Exports         | GET `/mad/reports/:type`                                                                                                                             | Manager-only; report/filter allowlists, no raw account/credential dump; bounded CSV/PDF.                                                                 |
| Realtime ticket | POST `/mad/realtime/ticket`                                                                                                                          | Manager session required; one-use random ticket, 30 seconds, at most 1000 outstanding per instance.                                                      |
| WebSocket       | `/mad/socket.io`, WebSocket transport                                                                                                                | Exact frontend Origin and one-use ticket; database authorization rechecked on sends/heartbeats; expired/revoked sessions disconnected.                   |

The frontend `/api/auth/[action]` keeps JWTs only in an HttpOnly, SameSite=Strict,
host-only cookie (Secure for HTTPS). `/api/staff`, `/api/promotions`,
`/api/complaints`, `/api/analytics` and its occupancy/operations children,
`/api/rooms/status`, `/api/kitchen/orders`, `/api/tasks`, `/api/reports/[type]`
and `/api/{realtime,kitchen}/ticket` forward server-held sessions. `/api/health`
is public. Browser mutations validate Origin against APP_ORIGIN; CRUD/auth BFFs
also require JSON and reject cross-site fetches. The backend accepts bearer
authorization, not a browser cookie, so CORS is not used as authentication.

Managers share hotel-wide access; guessing an existing staff/complaint ID while
authorized as a manager is not an ownership violation. Invalid/missing targets
must still produce safe 400/404 responses. This is not tenant isolation.

## Reviewed data and transport controls

- Global validation forbids unexpected DTO fields and hides target/input values.
  Query values use SQL parameters; fixed SQL fragments/projections are selected
  by code. Report formats, filenames, depth, rows, cell bytes, output bytes,
  pages, concurrency and database statement duration are bounded. CSV formula
  prefixes are escaped; downloads validate MIME, size and file signature.
- Auth locks a known account after five failed attempts for 15 minutes, uses
  scrypt and performs dummy hashing for unknown accounts. Gateway request/login
  limits are configured in its separate repository. They are per instance and
  protect the server connection address unless a trusted proxy is configured.
  Do not expose the direct backend publicly or assume forwarded headers are
  trustworthy. Apply ingress limits to both the BFF and socket upgrade paths.
- Staff credentials are AES-256-GCM encrypted with per-delivery associated data
  and fresh nonce; successful/cancelled deliveries clear the payload. Provider
  errors and audit logs use fixed codes/actor IDs/field names, not passwords,
  JWTs, request bodies or internal notes. SendGrid email remains a temporary
  credential delivery channel: verified sender, HTTPS and restricted provider
  key are operational requirements; mailbox compromise is outside MAD control.
- PostgreSQL synchronization is disabled. TLS verifies the server certificate
  when DB_SSL=true; use this for Neon. SQL changes remain manual. Use a dedicated
  runtime role with only the documented grants in each supplement, never the
  owner role. Only authorized complaint fields may be updated on FOSS data;
  KMS/WKMS/room source writes remain prohibited. No claim about actual Neon
  privileges can be made without running the read-only inspection as that role.
- Browser-facing production origins require HTTPS. Terminate TLS at the ingress,
  redirect HTTP and configure HSTS there after validating the actual deployment.
  Internal container HTTP is not an instruction to expose bearer traffic on a
  public network. Secure WebSocket routing and Origin must match the configured
  frontend. Current socket tickets/fanout require one MAD instance.
- The frontend build-config integrity guard remains enabled. Only the reviewed
  next.config.ts hash was updated for these response headers. Keep dependency
  install scripts disabled where already configured; never execute archived
  malicious source stored as investigation evidence in ignored docs.

## Findings and disposition

| ID         | Severity                         | Finding                                                                                                                              | Owner/disposition                                                                                                                                                                                                                                                                                |
| ---------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SEC-035-01 | Medium                           | Custom server-error codes could disclose internals                                                                                   | Backend maintainer: fixed, unit and real-database HTTP regression authored; retest pending CI.                                                                                                                                                                                                   |
| SEC-035-02 | Medium                           | Missing browser framing/sniffing/referrer restrictions                                                                               | Frontend/backend maintainers: headers added, regression coverage authored; browser/ingress verification pending.                                                                                                                                                                                 |
| SEC-035-03 | Medium                           | Production SQL logging could disclose sensitive parameters                                                                           | Backend maintainer: startup rejects it; configuration regression authored, CI pending.                                                                                                                                                                                                           |
| SEC-035-04 | Moderate dependency              | GHSA-hp3w-g68c-fv3c, sprintf-js via argparse/js-yaml/Istanbul/Jest/ts-jest; 20 affected package entries                              | Backend maintainer: retain reviewed test toolchain, no force downgrade. No high/critical findings in 2026-10-21 npm lockfile audit. Review compatible upstream fixes by 2026-11-14; do not use untrusted format/config input in CI.                                                              |
| SEC-035-05 | High, development-only exception | GHSA-vfj7-8cjw-p6xm through five frontend lint packages                                                                              | Frontend maintainer: existing narrowly checked exception expires 2026-11-14. Current audit gate passed with this exception; it does NOT mean zero high findings. Replace affected chain/review mitigation and attach retest before final DDP-035 release acceptance. No exception expanded here. |
| SEC-035-06 | Deployment verification pending  | Actual runtime grants, ingress TLS/HSTS/rate limits, proxy trust, broker ACLs and log retention are not established by source review | Deployment owner: capture staging evidence, least-privilege audit and trusted proxy configuration before release; do not use database owner credentials.                                                                                                                                         |

Audits query the npm registry and are time-specific, not proof of absence of
vulnerabilities. Backend audit exit 0 (0 high/critical, 20 moderate); frontend
audit:ci exit 0 with the existing five-package exception. Re-run both in CI.

## Acceptance register and evidence to collect

| Test ID               | Requirement / scenario                                                            | Coverage and expected result                                                                                                                           | Actual/status                                      |
| --------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| TC-MAD-035-AC1        | NFR-10, every protected REST route, missing/malformed/expired token, WORKER token | `src/common/security-boundaries.spec.ts`: 401/403 before handler; no-store/nosniff                                                                     | Authored, not run                                  |
| TC-MAD-035-AC1-DB     | Revocation, first login, guessed IDs, permission denial                           | `test/foundation.e2e-spec.ts` plus staff/promotions/complaints/reports/rooms/tasks integration suites, disposable PostgreSQL only                      | Existing/authored, not run in this task            |
| TC-MAD-035-AC1-WS     | Invalid/reused ticket, Origin, expiry, revoked sessions                           | `src/realtime/realtime.spec.ts`, `test/kitchen-realtime.e2e-spec.ts`, rooms/tasks/stock integration suites                                             | Existing/authored, not run in this task            |
| TC-MAD-035-AC2        | NFR-12/13, production error redaction and headers                                 | `src/common/http.spec.ts`, `test/foundation.e2e-spec.ts`, frontend `test/security-headers.test.ts`                                                     | Authored, not run                                  |
| TC-MAD-035-AC2-CONFIG | Prevent production SQL parameter logs                                             | `src/config/environment.spec.ts`                                                                                                                       | Authored, not run                                  |
| TC-MAD-035-AC2-CSRF   | Hostile fields/IDs, cross-origin JSON and credential exposure                     | Frontend auth/staff/promotions/complaints/reports BFF tests; backend corresponding feature integration tests; `test/reports.e2e-spec.ts` CSV injection | Existing, not run in this task                     |
| TC-MAD-035-AC3        | Dependency triage                                                                 | npm backend lockfile audit and frontend audit:ci; findings above                                                                                       | Executed; exception and moderate findings retained |

CI commands: backend `npm run lint`, `npm run format:check`, `npm run build`,
`npm run test:cov -- --runInBand`, `npm run test:integration`,
`npm audit --audit-level=high`; frontend integrity guard, lint, formatting,
coverage, build, `npm run audit:ci`, and browser acceptance workflow.
Use disposable test database/broker URLs, never Neon production credentials.

Attach the CI run URL, commit SHA, coverage artifact, audit reports, browser
traces, staging URL and date, role-audit output, and reviewer approval. On staging
repeat unauthenticated/WORKER/expired/revoked requests, ID and SQL/XSS payloads,
cross-origin mutations, CSV formula cases, token-free logs/downloads, socket
ticket replay/revocation and rate-limit exhaustion. Verify no complaint notes
reach unauthenticated/non-manager callers. Confirm Secure cookies, HTTPS/WSS,
response headers and no direct public backend bypass. Do not mark AC1/AC2 or
final AC3/release acceptance passed until this evidence exists and the high
dependency finding has its required release disposition/retest.
