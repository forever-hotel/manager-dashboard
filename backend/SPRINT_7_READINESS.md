# DDP-054: Sprint 7 / v0.3.0 integration gate

Audited2026-10-22 against source baseline
`2a0707567968790a6f8b788b957250eb0a43b9d6`. **Gate: BLOCKED / NOT_ACCEPTED.**
This is functional-completeness verification preparation, not production readiness
or authorization to publish. No tests, hosted SQL, deployment, issue updates or
tag/release publication were executed in this task. No executable/UI changes;
coverage for this documentation change is N/A, not a waiver for application coverage.

## Reviewed scope and records

- [Implementation matrix](release/v0.3.0/implementation-matrix.csv): all22 MD
  identifiers, additional SRS UI/task policy and supplementary session obligations.
  Backend/controller, BFF/page/component and candidate test paths were checked for
  existence; their actual runtime behavior remains unverified by this audit.
- [Acceptance register](release/v0.3.0/acceptance-register.csv): exact three DDP-054
  AC groups, expected/actual/status and required evidence.
- [Blocker register](release/v0.3.0/blockers.csv): source gaps versus missing
  provider/acceptance evidence, owner roles and blank real issue/person links.
- [Execution/review record](release/v0.3.0/REVIEW_RECORD.md),
  [unpublished notes](release/v0.3.0/RELEASE_NOTES.draft.md) and
  [retrospective worksheet](release/v0.3.0/RETROSPECTIVE.draft.md).

Scope is all22 MD identifiers including suffixes, SRS6.3 task policy and12.1.3 UI
obligations, with normal401/403 and safe-error boundaries. Source from later
tickets already present is included where it serves those requirements; its
presence does not accept separate performance/operations/production/UAT gates.

## Source findings

Most MAD paths have source and candidate unit/component/API/BFF/browser coverage.
The matrix is a mapping, not a claim that every assertion proves each criterion.
Inspect individual cases and attach current execution results before acceptance.

1. **MD-04 remains incomplete.** `AnalyticsController` exposes low-booking alerts
   and occupancy integration tests exercise the API. The Analytics page mounts
   booking/revenue and occupancy components; no visible low-demand alert/action
   or promotion date-prefill path was found. DDP-057 AC1/2/3 therefore remains open.
   Existing API/export availability cannot substitute for its manager-facing UI.
2. **MD-05c is not proven across HW.** MAD lifecycle/outbox/publisher and UI state
   exist, but actual website consumer/ACK/checkout/redemption and recovery evidence
   was not supplied. The HW fixture is development support, not acceptance.
3. **Staff paths exist; actual delivery/owner enforcement remains unaccepted.**
   Provision/edit/reset/deactivation, encrypted delivery/outbox and SendGrid
   implementation/tests exist. DDP-055's real delivery/retry/privacy evidence must
   be recorded, not described as missing implementation. Each owner must prove
   its own first-password-change, changed-role and revoked-session enforcement.
   Kitchen Manager partial MAD access remains an unresolved contract decision;
   this gate does not grant extra permissions to make a scenario pass.
4. **SRS task policy MAD flow exists; real WKMS adoption is pending.** Settings/API,
   version/history/confirmation and the reference claim fixture exist. Actual
   owner activation/atomic assignment enforcement and grants must be demonstrated.
   Do not call the test fixture deployed WKMS behavior.
5. **Notifications/accessibility/operations are implemented but unaccepted.**
   DDP-043 persistent source-derived alerts/read receipts and DDP-045 settings are
   present. DDP-048 scans/focus/reflow work and DDP-050 audit/status/templates exist.
   Manual accessibility, real provider recovery and operations storage/restore/
   alert evidence are still required. Historical source baselines must not be
   rewritten to pretend those earlier gates were accepted.

The backend remains manager-only, room/task/kitchen ownership stays read-only,
and production transport remains one active MAD instance pending shared fan-out.
No open contract decision is approved merely by documenting it here.

## Execution and coverage evidence to collect

Use `.github/workflows/ci.yml` on the exact final candidate and record baseline/
candidate SHAs and immutable job/artifact links. Required evidence includes:

- Backend/frontend lint/format/build, config integrity, security/audit results,
  complete unit/component suites, actual disposable PostgreSQL/RabbitMQ integration,
  browser acceptance including accessibility, container smoke and delivery tools.
- Measured changed-code line/branch coverage>=80% and critical business logic
  branches>=90%, with LCOV/baseline/critical-file artifacts. Configured thresholds,
  aggregate totals or old failing CI snippets are not final-candidate measurements.
- Explicit execution of any relevant opt-in suites not currently invoked by the
  default CI, such as performance-tool timing-unit tests; keep actual load/performance
  measurement approval separate. Tests were not run locally by this task.
- [DDP-046 real-service journeys](integration/DDP_046_VERIFICATION.md), not just
  contract mocks: all roles, email, actual HW checkout, complaints/notifications,
  read-only live boards, both export formats and actual WKMS policy enforcement.
- Current security/permission/error-envelope checks across the controller inventory,
  including later notification/settings/diagnostic endpoints. An unauthorized read
  or mutation cannot be waived as a lesser limitation.
- Accepted DDP-036/037 baseline review and DDP-048/050 evidence. Reference prepared
  registers without converting blank or NOT_RUN entries to PASS.

Record every required variant in the integration/UAT registers. Split partial
outcomes and link actual issues/owners/fix PRs and retest evidence. No named owner,
issue URL, passing test result or sign-off is fabricated by this audit.

## Gate decision and next steps

AC1 is BLOCKED by MD-04's missing UI and unverified cross-service paths. AC2 is
NOT_RUN because no final-candidate passing test/coverage evidence was supplied.
AC3 retains open blockers; notes/retrospective remain drafts. This does not mean
the gate ran live or that actual external Jira states were changed.

Implement/accept DDP-057 in its named scope, close real-provider and prerequisite
gaps with accountable owners, run the authorized CI/staging matrix, resolve/retest
defects and obtain peer review. Then finalize the record, v0.3.0 release notes and
actual sprint retrospective. Any subsequent change requires impact review/retest.
Only then may the authorized release owner publish the tag/notes. Functional
completeness is not production authorization: DDP-052/051 and other release gates
remain separate and must not be inferred complete from v0.3.0 preparation.
