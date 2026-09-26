# DDP-001–008 implementation review

Date: 2026-09-26. Scope: source implementation and removal of later-ticket code.
The user requested no test execution. No unit, integration, browser, build,
container or real-provider acceptance checks were run in this pass.

DDP is the current ticket prefix; MAD references in historical planning documents
identify the same backlog numbers. The September 15 completion audit describes
the older committed state and is retained as historical evidence.

## Source implementation

| Ticket  | Implemented code and documentation                                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DDP-001 | Next.js/React/TypeScript/Tailwind scaffold, lockfile, public API URL validation, read-only lint/format commands and documented runtime/setup                                                                                                |
| DDP-002 | NestJS configuration validation, global DTO validation, stable redacted error envelope, no-store responses, separate liveness/database readiness                                                                                            |
| DDP-003 | Multi-stage non-root images, persistent PostgreSQL volume, restricted runtime role initialization, serialized migration service, backend/frontend readiness and frontend outage/retry UI                                                    |
| DDP-004 | GitHub Actions on every branch push and develop/main PRs, non-mutating lint/format checks, builds, unit coverage thresholds/artifacts, disposable database integration, browser/container jobs and blocking high/critical dependency audits |
| DDP-005 | Central Auth adapter, HS256/issuer/subject/8-hour validation, manager guard, per-request central revocation checks, durable local logout revocation, forced password change, HttpOnly cookie/BFF and CSRF controls                          |
| DDP-006 | Transactional version registry, advisory lock, existing prefixed promotion-schema adoption, constraints/indexes, role/permission checks, reporting-read allowlist and forward-recovery documentation                                        |
| DDP-007 | Protected App Router layout and proxy, session rechecks/expiry handling, no cached protected content, all 12 destinations, active styling, keyboard focus/skip link and mobile navigation                                                   |
| DDP-008 | Username/password validation, central login submission, generic rejection, timeout/retry, duplicate-submit prevention through navigation, intended-destination return, expired-session and forced-change flows                              |

The DDP-001–008 implementation paths are present after this review. This is not
runtime acceptance or a declaration that every ticket's Definition of Done passed.

Static verification passed for both applications: ESLint, Prettier formatting
checks and TypeScript `tsc --noEmit --incremental false`. Next.js route types were
regenerated without running a build. Source searches found no remaining references
to the removed feature modules or production shared-schema script. Existing test
fixture type errors and an unused import were corrected without executing tests.

## Scope removed

- Booking/occupancy/low-demand analytics APIs from DDP-009–011.
- Staff account creation API, staff credential entity and unused authentication
  dependencies used by that later-ticket implementation.
- Mock analytics, room boards, promotions, staff management, complaints, food,
  service and worker-performance screens, including sample records and dead actions.
- Unused greeting controller/service and the all-subsystems production schema SQL.

The required navigation routes remain, with shared neutral "Coming soon" content
using the existing white/gray-border style. These shells do not claim later-feature
completion. The promotion database foundation remains because DDP-006 requires it.
Existing test fixtures were decoupled from deleted APIs/schema; they were not run.

## Changes that close source gaps

- Frontend readiness now checks backend readiness instead of reporting unconditional
  success, and login can show an outage before accepting credentials.
- The frontend container starts independently so database/backend startup failures
  can be explained in the UI.
- The BFF selects safe session fields explicitly and preserves forbidden status
  on session reads; unsuccessful logout does not falsely report success.
- Duplicate login stays locked until navigation; session expiry preserves the
  current destination and malformed session payloads fail closed.
- Migration connections release even on transaction-start failure; the runner
  rejects privileged/inherited/owning runtime roles and leaked shared-table writes.
- Setup and integration documentation now describes the implemented configuration,
  provider contract, database boundaries and recovery procedure.

## Not established by this review

Real central Auth/Gateway agreement and integration, final database ownership/
reporting agreement, support for an unprefixed legacy schema, hosted branch
protection, passing CI/coverage, actual container health/persistence, browser
behavior, staging deployment and peer approvals remain unverified. These cannot
be inferred from source files or a test-only provider. DDP-038 remains the external
contract dependency; no external owner agreement has been invented.

No ticket statuses were marked Done and no application database was modified.
