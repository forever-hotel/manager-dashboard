# DDP-046 real-service verification

Prepared 2026-10-21. **Gate: NOT_ACCEPTED. Execution: NOT_RUN.** Staging is
not ready, as confirmed by the requester. This change prepares verification;
it does not certify integration or execute tests, SQL, or provider mutations.
There are no executable changes, so coverage for this documentation change is
N/A. Delivered application coverage and passing CI remain required evidence.

The [case register](acceptance-register.csv) maps all 22 MD requirements,
SRS 6.3 task limits and DDP-046 AC1/AC2/AC3. Candidate test files are supporting
references, not real-provider evidence. In particular, the HW and WKMS fixtures
under `test/fixtures/` and the Playwright contract stack cannot close this gate.

## Before execution

QA records the following in [the evidence record](EVIDENCE.md), with a named
reviewer from each owner. Keep credentials in the team's private secret store.

1. Candidate MAD commit, baseline SHA, frontend/backend/gateway builds, and the
   immutable deployed revision and contract version of HW, FDS, FOSS, KMS and
   WKMS. Review [ownership decisions](../contracts/DDP_038_REVIEW_REGISTER.md).
2. Staging URLs, direct socket route, private test-account references for manager,
   receptionist, worker, Kitchen Staff and Kitchen Manager, and approved access
   to a real email test inbox. Confirm actual subsystem first-login/password-hash
   compatibility, HW checkout/acknowledgement and WKMS claim enforcement exist.
3. A dedicated persistent staging dataset and fixture ledger: IDs, initial values,
   owner, expected aggregates and cleanup plan. Use synthetic data only. Owners
   create source records through their actual service workflows; MAD must not
   invent owner data. Never target production Neon or use CI fixtures as providers.
4. Schema supplement versions applied manually by the DB owner, actual dedicated
   role grants, broker bindings, publisher settings and socket routing. Do not
   apply SQL or enable schema synchronization as part of this procedure.
5. Final-candidate green CI job/artifact URLs, measured coverage and security
   results. Required changed-code coverage is >=80% lines/branches and critical
   business logic >=90% branches. Review any current audit exception's scope and
   expiry. Existing auth/export browser journeys do not cover this entire matrix.
6. Owner-approved outage/reconnect/replay windows and restoration checks. Agree
   expected event timing before measurement; no invented latency target here
   (capacity/performance verification belongs to DDP-047).

Do not start a case whose provider or prerequisite is missing. Record BLOCKED,
the owner and an actual issue link. Never turn an unavailable integration into a
mocked PASS. DDP-057's missing low-demand suggestion action blocks full MD-04.

## Execute AC1: requirement journeys

Run every `MD-*` row using persistent data in the actual owning subsystem. Use
[metric examples](../contracts/DDP_038_METRIC_EXAMPLES.md) and
[current decisions](../CONTRACT_DECISIONS.md) for independently calculated
expected values. Record Asia/Colombo time and period boundaries; use Monday-start
weeks. Booking totals use check-in dates; completed-payment revenue uses paid_at,
LKR cents and whole previous periods, with null percentage for zero baseline.
Do not silently substitute refund accounting or created-at booking counts.

Capture both the MAD response/rendered view and owner-side record identifiers or
redacted read-only evidence. For live room/kitchen/task/stock changes, record source
version/event ID, before/after state and refresh/reconnect outcome. Keep the
existing read-only MAD ownership boundaries. For exports, run CSV and PDF for
each canonical report type, preserve matching filters and a stable source snapshot,
and compare values, units, totals, nulls and empty results with the displayed view.
Inspect multilingual rendering and CSV formula neutralization with synthetic input.

## Execute AC2: three critical journeys

### Staff creation, email and first login

For each provisionable role, create a unique synthetic email in MAD; record the
account ID and delivery/job reference. Verify exactly one persisted account and
email delivery in the test inbox, without copying passwords into evidence. Log
into the actual owning subsystem with delivered credentials: protected access
must require first password change. Change it, log out/in with the new password,
and verify the temporary password fails. Restart MAD and confirm it has not reset
the password. Test reset and deactivation separately: existing owner sessions
must lose access, reset requires another change, and inactive login is denied.
The subsystem owner must demonstrate its own enforcement; MAD flags alone do
not prove it. See [staff guide](../STAFF_UI_GUIDE.md).

### Promotion publication and website redemption

Create a unique eligible promotion in MAD, recording version and outbox event.
Observe actual HW consumption/acknowledgement and website eligibility, then redeem
through real HW checkout. Compare booking discount, redemption count, amount and
MAD publication state. Test expiry, ineligible room and exhausted maximum. Edit,
deactivate and logically delete with current versions; observe HW removal while
booking history remains. Replay the same event and an older version: no duplicate
redemption or state regression. Saving in MAD or an empty outbox alone is not
proof of website application. See [publication guide](../PROMOTION_SYNC_GUIDE.md).

### Complaint submission, resolution and notification clearing

Submit via real FOSS, observe the same complaint in MAD, and record source ID.
Move SUBMITTED -> UNDER_REVIEW -> RESOLVED with notes/current versions. Verify
FOSS status/resolved time and MAD-only actor/history/note ownership. Stale writes
must fail without overwriting the winner; reopening is not permitted. Confirm
the resolved complaint leaves active notifications and all shared badge/banner
counts agree, including after refresh/reconnect. Marking read must not resolve or
remove an active source alert. See [notification guide](../NOTIFICATIONS_GUIDE.md).

## Execute AC3: failure and recovery

- For every protected method in the [endpoint inventory](../contracts/endpoint-inventory.csv)
  and current controllers (including notifications and task-limit settings), test
  missing/invalid/revoked sessions -> 401, valid disallowed roles -> 403, and
  guessed IDs/invalid input/stale versions with safe `{code,message,details?}`
  envelopes. Verify database state does not change after denied writes. Inspect
  browser, direct REST and live sockets; revocation must stop subsequent data.
- With the owner's approval, interrupt email delivery and retry: credentials stay
  private, no second account appears, and resumed delivery matches the current
  credential version. Measure duplicate delivery separately from duplicate accounts.
- Interrupt HW/broker delivery: publication remains pending/failed visibly; restore
  it and verify eventual current-version application. Replay identical and older
  events; inspect outbox, consumer and source state for duplicates/regressions.
- Interrupt KMS/FDS/WKMS source/event delivery and the browser socket. Verify stale
  or error feedback, bounded retries/polling, then authoritative reconciliation.
  Verify no unauthorized subscriptions, duplicate cards, missing updates or stale
  versions overwriting newer state after reconnection.
- Submit two edits with one version and verify one winner/one conflict. With real
  WKMS, race two claims for a worker with one remaining slot: exactly one claim
  succeeds. Test limit 1 and 10, invalid 0/11/fraction, default requested 3, pending
  versus confirmed policy, activation outage, and reduction retaining existing
  tasks. Count assigned ASSIGNED/IN_PROGRESS/ESCALATED tasks only. Actual WKMS
  must atomically enforce all assignment paths; the local reference fixture is
  insufficient. See [policy handoff](../TASK_LIMIT_GUIDE.md).

## Evidence and acceptance

For each register row, fill actual result, execution date, SHA, fixture IDs,
provider revisions, evidence link, defect link and reviewer. Split role/report/
failure variants into child rows if outcomes differ; never mark the parent PASS
until every required variant passes. Use NOT_RUN, BLOCKED, FAIL or PASS; missing
evidence is never PASS. Evidence must contain sanitized requests/responses,
screenshots/files, owner-side persistent outcomes and correlation IDs; exclude
cookies, tokens, passwords, API keys and real guest data.

After cleanup, owners confirm synthetic accounts are disabled, promotions are
removed from checkout, test complaints/tasks restored as agreed, provider/broker
configuration restored and normal health recovered. Keep evidence outside ignored
`docs/` in the approved restricted artifact store and link it here.

Close DDP-046 only after every requirement and three AC groups pass on the same
candidate, real-provider gaps close, CI is green, defects are resolved, and a peer
plus affected owners approve. Record the PR/Jira links and approval date. Any
subsequent code/provider change requires affected cases and CI to be reassessed.
Do not change Jira to Done for this prepared pack alone.
