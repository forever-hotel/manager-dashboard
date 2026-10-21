# Change log

## Unreleased - DDP-040

- Add opt-in transactional promotion outbox publication with persistent mandatory
  routing, broker confirms, stable IDs and database-backed capped backoff.
- Add a manual outbox retry-column/index/grant supplement; startup runs no SQL.
- Add publisher unit/integration tests and explicit test-only HW consumer/checkout
  contract fixtures for eligibility, lifecycle, history and atomic final use.
- Document proposed HW wire/checkout semantics and remaining owner/staging gates.

UI unchanged. Tests unrun locally; publisher defaults disabled. Actual website
consumer, idempotent checkout/payment enforcement and staging acceptance remain
pending, not replaced by reference fixtures. See [guide/register](PROMOTION_SYNC_GUIDE.md).

## Unreleased - DDP-039

- Complete the existing broker/socket transport with immutable kitchen event-ID
  checks, permanent-conflict dead-lettering and transactional retirement of unsent
  older invalidations while retaining durable receipts.
- Reject malformed socket handshake auth and expire tickets exactly at30seconds.
- Prevent late kitchen snapshots from restoring protected data after ticket denial.
- Add unit, real-database/socket and component regressions for conflict/restart,
  authorization races and bounded/manual reconnect behavior.

UI unchanged; no new SQL/env or hosted database execution. Tests remain unrun
locally; CI and real-provider/timing acceptance pending. See [register](REALTIME_GUIDE.md).

## Unreleased - DDP-038

- Add field-level ownership and cross-system API/event contract review pack.
- Record explicit blocking decisions for session/hash policy, Kitchen Manager
  scope, UI timing, complaint/staff writes, schema compatibility and CI differences.
- Add hand-calculated calendar, revenue/refund, capacity, cohort, threshold and
  proposed task-limit boundary/concurrency examples.
- Create ADR-038-001 and link the actual review/approval register. Owner names,
  delivery dates, external adoption and supervisor acceptance remain pending.

Documentation only; no runtime/UI changes, tests, hosted SQL or external messages.
DDP-038 is prepared for review, not marked Done. See
[the acceptance register](contracts/DDP_038_REVIEW_REGISTER.md).

## Unreleased — DDP-037

- Reconcile implemented REST/BFF/event contracts, validation, permissions,
  safe examples and analytical metric/timezone policies.
- Add clean-checkout configuration, manual schema/grant prerequisites, initial
  manager setup, disposable test-service instructions and operational guidance.
- Link delivered MD requirements to code, candidate tests and existing decisions;
  mark missing features/owner agreements/execution evidence explicitly.
- Correct README reset-body guidance and stale export implementation wording.

Documentation only: no runtime/UI/API behavior changes, schema execution or test
execution. These entries do not publish v0.2.0 or assert clean-checkout, staging,
coverage or final integration acceptance. See the DDP-037 review register below.

## DDP-037 acceptance/verification register

All cases priority High. Source baseline is the parent commit plus this
documentation diff; record the actual candidate SHA in the reviewing PR.

| ID             | Requirement / type                                 | Preconditions and input                                                                                         | Expected                                                                               | Actual / status / evidence                                                                                                                                                   |
| -------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-MAD-037-AC1 | NFR-16; Guide4.3; SDS1.4; documentation inspection | Current controllers/DTOs/services, BFF schemas and event consumers                                              | Implemented paths, requests/responses, permissions/errors/examples/versions documented | Source reviewed; static link and inventory checks recorded in task output. Peer/provider review pending; no HTTP/event execution claimed. [API reference](API_CONTRACT.md)   |
| TC-MAD-037-AC2 | Guide9.3; SDS7.5; clean-checkout acceptance        | Clean checkout, approved gateway checkout, development DB schema/role, disposable test services; follow runbook | Setup/config/manual prerequisites/tests succeed with recorded versions/commands        | NOT RUN under user's no-local-tests constraint. CI plus independent setup review pending. [Runbook](DEVELOPER_GUIDE.md)                                                      |
| TC-MAD-037-AC3 | Guide6.3.3; traceability review                    | Delivered MD identifiers, ticket scope, existing code/tests/decision sources                                    | Requirement links, honest gaps, changelog, no secrets or fabricated completion         | Matrix and decision log prepared; candidate file existence checked. Formal ADR links/owner acceptance and peer approval pending. [Traceability](REQUIREMENT_TRACEABILITY.md) |

Static verification: 130 relative Markdown links resolve, all 40 extracted
method/path inventory entries reference existing controllers, and all 25
traceability rows (22 MD identifiers) reference existing candidate source/tests.
Markdown formatting and diff whitespace checks pass. This is inspection evidence,
not API execution, a secret-history scan or clean-checkout acceptance.

No defects were filed or evidence URLs fabricated. Attach the PR/peer review,
clean-checkout command transcript with secrets redacted, final SHA/tool versions,
CI artifacts and actual owner ADR/contract links to close acceptance. Code
coverage for this documentation-only change is N/A; delivered application coverage
requirements remain enforced by CI and must not be marked passed from this entry.
