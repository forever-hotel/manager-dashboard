# DDP-036: Sprint 6 / v0.2.0 readiness

Reviewed 2026-10-21 against `docs/mad_jira_tickets.csv`, Guide 2.2/3.3/6.4 and
SDS 7.5. Source baseline: `8f379b3917fd320c91ee19a818021d80908a4910`.
**Gate: NOT ACCEPTED.** This is an evidence review, not a product feature or
permission to publish a version. No tests were run locally, no hosted SQL was
executed, and no release/tag/Jira state was changed.

## Review pack

- [Acceptance register](release/v0.2.0/acceptance-register.csv): all 58 acceptance
  criteria across the 19 Sprint 6 tickets, including DDP-036. Each row records
  its ID, ticket, criterion, scenario, priority, preconditions, expected/actual
  result, candidate test files, status and evidence/defect fields.
- [Staging review procedure](release/v0.2.0/STAGING_REVIEW.md): promotion publication,
  complaint resolution, all four staff roles and operational negative cases.
- [Draft release notes](release/v0.2.0/RELEASE_NOTES.draft.md) and
  [retrospective worksheet](release/v0.2.0/RETROSPECTIVE.draft.md): unpublished
  preparation only. DDP-036 requires final notes/retrospective after acceptance.

The register was generated from the current ticket acceptance criteria, rather
than from assumed completion order. All linked candidate test files exist.
File presence is not proof that every assertion satisfies a criterion: reviewers
must inspect cases, attach execution evidence and split rows when outcomes differ.
Missing implementation rows have no invented test links. Existing tests retain
their IDs; register IDs are acceptance mappings, not claims that every test title
already embeds that ID. The original documents remain unchanged.

## Scope and blockers

Sprint 6 scope is DDP-018/019/020/021/022/024/025/027/029/032/034/036/039/040/
041/042/044/045/057. DDP-017 foundation acceptance is also an explicit prerequisite.
DDP-023 analytics, DDP-026/028 live boards, DDP-030/031 exports and other later
Sprint 7 scope are not accepted by this gate, even if code already exists. The
shared CI must still test all delivered code; scope exclusion does not excuse
regressions elsewhere in the repository.

| Blocker   | Source review                                                                                                                            | Required closure / owner                                                                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DDP-017   | Earlier foundation acceptance evidence was not supplied                                                                                  | QA/release reviewer: attach accepted prerequisite and CI/staging links.                                                                                                                     |
| DDP-040   | MAD save/lifecycle/outbox publisher and retry implemented; actual HW production consumer/checkout/acknowledgement integration unverified | MAD + HW owners: implement/test the agreed publication path; demonstrate actual website state and failure recovery. Saving or `NO_PENDING_WORK` alone is not proof of website availability. |
| DDP-045   | MAD task-limit API/Settings and shared-DB confirmation handoff implemented; real WKMS claim enforcement/adoption remains pending         | WKMS owner: adopt reviewed versioned activation/ACK and atomic claim/assignment locking; attach real-provider evidence. MAD saves stay pending until confirmation.                          |
| DDP-057   | No low-demand promotion-suggestion action/date-prefill found in Analytics                                                                | Frontend owner: implement the specified actions/states without treating a failed source as healthy demand; link tests and staging results.                                                  |
| Execution | No current passing CI, coverage or real-provider staging evidence supplied                                                               | QA: run the delivered-code workflows in CI and complete the staging review. No local tests were run.                                                                                        |
| Coverage  | CI now enforces whole-suite plus changed-code LCOV thresholds; measured final-candidate evidence still pending                           | QA: attach baseline/candidate SHAs and measured changed-code line/branch results, plus critical-logic branch evidence. Whole-project 80% alone does not prove changed-code 80%.             |

Register `BLOCKED` means an identified implementation blocker; `NOT_RUN` means
evidence has not been collected in this task. Neither means passed. Defect links
are blank because no issue was created or supplied; link an actual issue before
review, rather than treating these labels as Jira defect IDs.

## CI and endpoint evidence

Use the existing `.github/workflows/ci.yml` against the final candidate commit:

1. Backend lint, formatting, build, unit coverage, disposable PostgreSQL/RabbitMQ
   integration and dependency audit must pass.
2. Frontend config integrity, lint, formatting, component/BFF coverage, build and
   audit gate must pass.
3. Browser acceptance and container smoke jobs must pass. Existing browser suites
   cover auth and exports, not the complete Sprint 6 core demonstration. Component
   tests and contract fixtures do not replace the staging procedures below.
4. Record changed-code lines/branches >=80%, critical business logic branches
   > =90%, test totals, job/artifact URLs, SHA and execution date. Capture actual
   > measured values; do not fill them from configured thresholds.

| Endpoint group                                                          | Candidate real-database integration suite      |
| ----------------------------------------------------------------------- | ---------------------------------------------- |
| Login/session/password change/logout                                    | `test/foundation.e2e-spec.ts`                  |
| Promotion create/list/detail/room types/edit/activate/deactivate/delete | `test/promotions.e2e-spec.ts`                  |
| Complaint list/detail/versioned resolution                              | `test/complaints.e2e-spec.ts`                  |
| Staff create/list/detail/profile/role/reset/deactivate, all roles       | `test/staff.e2e-spec.ts`                       |
| Service-request analytics                                               | `test/service-request-analytics.e2e-spec.ts`   |
| Worker-performance analytics                                            | `test/worker-performance.e2e-spec.ts`          |
| Food metrics used by operations UI                                      | `test/food-analytics.e2e-spec.ts`              |
| Room snapshots and events                                               | `test/rooms.e2e-spec.ts`                       |
| Realtime ticket / kitchen API / socket transport                        | `test/kitchen-realtime.e2e-spec.ts`            |
| Read-only tasks API/events; denied claim/assign/complete                | `test/tasks.e2e-spec.ts`                       |
| Stock events/recovery/bounded retry/DLQ                                 | `test/stock.e2e-spec.ts`                       |
| Task-limit settings and cross-system publication                        | Missing implementations/evidence, gate blocked |

The DDP-035 `src/common/security-boundaries.spec.ts` complements these suites with
missing/invalid/expired/disallowed-role checks; it uses isolated storage and is
not a real-database integration substitute. Review every delivered method/action,
including invalid UUIDs, guessed missing IDs, stale versions, input allowlists,
401/403 and safe error envelopes. Use disposable test services for CI, never Neon
production. Staging must use the actual owning systems, not only mocks.

## Acceptance decision

| Criterion      | Current result | Evidence required                                                                                                                           |
| -------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-MAD-036-AC1 | Pending        | Every register row has reviewed assertion links, actual outcome, execution date/SHA, evidence URL and defects for failures.                 |
| TC-MAD-036-AC2 | Pending        | Green complete-code CI, coverage measurements and endpoint integration evidence.                                                            |
| TC-MAD-036-AC3 | Blocked        | Missing features complete, real-provider staging demonstrations accepted, reviewer sign-off, then finalized v0.2.0 notes and retrospective. |

DDP-036 cannot truthfully be marked complete from code inspection alone. After
all blockers close, record candidate SHA, baseline SHA, staging URL, CI run URL,
coverage artifacts, provider contract versions, test data identifiers, reviewer
and approval date. Finalize notes and retrospective only then; any subsequent
code change requires affected checks and sign-off to be refreshed.

One review fix is included: the environment regression test now expects local
DB_LOGGING=true to be rejected, matching the pre-existing staff data-protection
validation. It previously asserted that local logging was allowed. Runtime
behavior and the UI are unchanged. The corrected test remains unrun locally.

Local verification for this review: backend TypeScript and targeted ESLint
passed; changed Markdown/TypeScript formatting and `git diff --check` passed.
Register checks confirmed 58 unique acceptance IDs and existing candidate file
links, with no invented passing results. These static checks do not close any
execution, coverage or staging acceptance criterion.
