# Manager acceptance - DDP-052

Prepared 2026-10-22. **Gate: NOT_ACCEPTED. UAT execution: NOT_RUN.** This pack
prepares manager/supervisor acceptance; it does not record invented testers,
passing results, defect resolutions or signatures. No tests, provider mutations,
SQL, deployment, release tag or external issue changes ran for this task.
No executable code or UI changes are made, so this documentation change's code
coverage is N/A; the delivered application's CI/coverage evidence is still needed.

## Review pack and entry gate

- [Scenario register](scenarios.csv): 58 cases covering all22 MD identifiers, task policy, UI/security,
  every staff role and each CSV/PDF report variant. Each case has a concrete input,
  expected result and blank actual/tester/date/evidence fields.
- [Readiness gaps](readiness-gaps.csv): identified preconditions, not observed UAT
  defects. Local labels are not Jira issues or assignments to actual people.
- [Defect register](defects.csv): intentionally empty until a genuine finding.
- [Execution and sign-off](SIGN_OFF.md): explicit approval fields left blank.

The manager and supervisor first approve the scenarios and permitted synthetic
fixtures. Record their actual names/roles, UAT URL, candidate SHA/image digests,
provider revisions, date/time and private account references in SIGN_OFF.md.
Never paste passwords, JWTs, cookies, encryption keys or real guest data there.
No self-service manager approval or prior chat message substitutes for actual
client/supervisor UAT acceptance.

Entry requires accepted DDP-035 security, DDP-047 performance, DDP-048 accessibility,
DDP-050 operations and DDP-054 completeness evidence, plus DDP-046 real-provider
integration. Their prepared code/test files are not acceptance results. Confirm
all provider contracts, schema supplements/grants, broker/socket routes, actual
staff logins/email inbox, HW checkout and WKMS policy enforcement before cases.
Review [open ownership decisions](../contracts/DDP_038_REVIEW_REGISTER.md),
[requirement traceability](../REQUIREMENT_TRACEABILITY.md) and
[real-service verification](../integration/DDP_046_VERIFICATION.md).

## Conduct the manager walkthrough

1. Facilitator records the candidate and fixture ledger; manager/supervisor review
   each expected result before starting. Fix expected totals using independently
   calculated source records, not whatever the dashboard currently displays.
2. Manager performs each scenario through the UI using keyboard and pointer;
   provider owners perform source-system actions where needed. Preserve existing
   independent subsystem logins and read-only operational ownership boundaries.
   Test all required variants; if outcomes differ, split child rows and keep the
   parent unaccepted until every variant passes.
3. Record actual result in the tester's words, actual tester/date, synthetic IDs,
   SHA/provider revisions and sanitized evidence links immediately. NOT_RUN means
   unexecuted; BLOCKED means a specific missing prerequisite; FAIL means executed
   and incorrect; PASS requires expected versus actual plus attributable evidence.
4. Save sanitized screenshots, exports, inbox delivery references and source/MAD
   state comparisons in the approved restricted artifact store. A mock response,
   test filename or screenshot alone does not prove cross-system completion.
5. Do not run local tests as part of this agent task. QA/user executes supplied
   suites in CI and authorized UAT services, records failures and links artifacts.

### Scenario procedures

The CSV contains the steps and expected results; follow these shared rules:

- Analytics: use Asia/Colombo and Monday-start weeks. Booking counts use check-in
  date/included statuses. Revenue is COMPLETED payments by paid_at, LKR cents,
  whole previous periods and null percentage for zero baseline. Refund recognition
  is not invented. Confirm empty/unknown data differs from zero/error states.
- Charts/occupancy: compare every selected period/date with the equivalent data
  table, legend and exact source totals; include month boundaries and zero capacity.
- Staff: repeat create/email/owner first login, reset, edit/role change and
  deactivation for Receptionist, Worker, Kitchen Staff and Kitchen Manager. Owner
  systems must enforce their own password change and session invalidation; seeing
  MAD flags is insufficient. Kitchen Manager does not automatically get MAD
  access: partial-access scope is still an owner/security decision.
- Promotions: check normalization, eligible rooms, lifecycle/version conflicts,
  real HW publication/ACK/redemption and booking history after logical deletion.
  Saving in MAD alone does not prove the website applied the promotion.
- Complaints: submit in FOSS; review/resolve in MAD using notes/current versions;
  verify owner status/time and MAD-private history. Reading an alert must not
  resolve its source. Confirm alert persistence after navigation/login/reconnect
  and clearing only after actual source resolution/stock recovery.
- Operations: KMS/FDS/WKMS owners create updates. MAD must show the correct kitchen,
  room and task states, remain read-only and recover after a disconnection. Do not
  count contract fixtures as real provider adoption.
- Task policy: integer1..10/default3, assigned ASSIGNED/IN_PROGRESS/ESCALATED cohort.
  Distinguish requested from WKMS-confirmed versions. Reductions retain existing
  tasks; the actual WKMS owner must demonstrate atomic claims at the limit.
- Exports: each canonical report type in both CSV and PDF, with the same filters
  and stable source snapshot; compare counts/currency/units/nulls/empty data,
  filenames and readable Unicode. Cover per-view controls and Reports index.
- Accessibility/security: keyboard navigation, confirmations, error/retry and
  focus restoration; actual zoom/tablet use and chart/text alternatives. Missing/
  invalid sessions401, disallowed roles403, logout/revocation, no stale protected
  content, and no credentials in UI/logs/evidence. Feature access must not expand
  merely to complete a scenario.

MD-04 includes visible low-demand promotion suggestions/date-prefill. That action
is still absent in the reviewed Analytics source (DDP-057); do not mark the whole
requirement passed just because the low-booking API works.

## Defect triage and retest

Use defects.csv only for real findings, with an actual issue link once created.
Record scenario/requirement, observed impact, reproduction/fixtures, expected and
actual outcome, severity, accountable person/team, fix PR/SHA and retest results.
Suggested triage definitions for reviewer agreement:

- BLOCKER: security/data integrity risk or required journey cannot complete.
- MAJOR: required behavior materially wrong, even if a workaround exists.
- MINOR: a lesser limitation that does not invalidate required functionality.

BLOCKER/MAJOR findings prevent sign-off until fixed and retested by the manager/QA
on the recorded candidate. Implementation claims or a closed issue alone do not
close a finding. Retest original/affected scenarios and relevant CI/provider flows;
record new SHA, results, tester/date and evidence. Preserve previous failures.
Never downgrade severity simply to clear the release gate.

Unresolved lesser limitations need explicit impact/workaround, owner, target date,
residual risk and actual manager/supervisor disposition. An empty waiver is not
approval; mandatory security/data/requirement failures cannot be silently waived.
Link accepted limitations in release notes and the handover material. No defect
is pre-populated as fixed and no lesser limitation is pre-approved in this pack.

## Sign-off and handoff

After all scenarios/variants and entry gates pass, reconcile findings, limitations
and evidence with the actual manager/supervisor. Complete SIGN_OFF.md with their
real recorded decisions and links. Later code/provider changes invalidate affected
results and require impact review/retest. Until then DDP-052 stays open and
DDP-051's UAT prerequisite is unmet. UAT sign-off permits readiness review for the
week15 production-like rehearsal; it does not itself authorize production release.
Follow [the separate release gate](../../deploy/release/RELEASE_GUIDE.md).
