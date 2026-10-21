# Worker task-limit settings - DDP-045

MAD's Settings/API and shared-database WKMS handoff are implemented. Actual WKMS
production claim enforcement/adoption remains external and unverified. No tests,
hosted SQL, release or cross-team sign-off were executed in this task.

## Approved policy and ownership

The project owner approved integer limits1..10 inclusive, default3. Count tasks
in ASSIGNED, IN_PROGRESS or ESCALATED **with an assigned worker**. UNASSIGNED,
COMPLETED and escalated tasks with no worker do not count. The limit is global
hotel policy, applied independently to each worker. Reductions never delete,
unassign or complete existing tasks; new claims/assignments wait until load<limit.

MAD owns requested policy, monotonically increasing versions and history. WKMS
owns effective-policy activation and every claim/assignment. MAD adds no task
claim endpoint and performs no WKMS task writes. This follows the user's approved
MAD-flow/handoff scope; it does not claim DDP-045 AC3 passed in deployed WKMS.

## Manual database setup

Review and manually apply `deploy/neon-mad-task-limit.sql` after the shared
staff/auth schema. It creates request/history/confirmation tables and a restricted
confirmation function, seeds requested3/version0 once, and preserves later values
on rerun. It never changes task rows or seeds an effective acknowledgement.
Startup does not execute SQL; keep synchronization disabled. No new env/dependency
or broker configuration is needed. Missing schema/grants returns sanitized503.

Adapt the commented grants for separate dedicated MAD and WKMS login roles. The
deployment owner must own the policy/function; MAD runtime must not own them or
inherit WKMS/deployment privileges. MAD reads acknowledgements but cannot write or
call the confirmation function. WKMS reads requests and may lock their singleton
row using its narrowly granted UPDATE(singleton) permission; it must not write
requested limit/version/history. Confirmation function EXECUTE is WKMS-only, with
PUBLIC privileges revoked and fixed pg_catalog search_path/qualified tables.
Check inherited grants as well. A database-owner runtime bypasses this separation.

No person should call confirmation merely to make the Settings status green.
It represents actual WKMS activation, committed with the owner policy transaction.
All provider roles and grants still require the schema/WKMS owner's real review.

## API and UI

GET `/mad/settings/task-limit` returns:

```json
{
  "limit": 3,
  "version": 0,
  "updatedAt": "2026-10-21T00:00:00Z",
  "effectiveLimit": null,
  "effectiveVersion": null,
  "confirmedAt": null,
  "status": "PENDING",
  "defaultLimit": 3,
  "minLimit": 1,
  "maxLimit": 10,
  "activeStates": ["ASSIGNED", "IN_PROGRESS", "ESCALATED"],
  "assignedWorkerRequired": true
}
```

PATCH accepts only `{"limit":2,"version":0}` with actual JSON integers, no query
fields. Manager after first-password change required. Invalid input400;
missing/invalid session401; disallowed403; stale/exhausted version409; unavailable
storage503. Responses are sanitized/no-store. A current-version unchanged-value
save is a no-op. Real changes lock policy, insert actor/history and increment its
version atomically. Concurrent writers with the same expected version cannot both
overwrite it. Failed history/policy writes roll back together.

`limit` is requested, not effective. EFFECTIVE requires exact acknowledged version
and limit. A pending change retains the last acknowledged limit/version; before
initial WKMS bootstrap those are null, never a fabricated effective3. An older
confirmation does not become current just because its value happens to match.

The `/api/settings/task-limit` BFF keeps JWTs server-side, validates source shape,
bounds/cohort/ack consistency and requires same-origin JSON writes. Settings
preserves existing visual styling, shows requested/confirmed versions distinctly,
polls every10seconds for acknowledgement, retains dirty drafts and handles stale
writes without automatic resubmission. Reload current version preserves the draft
for deliberate review. A timeout may have committed: refresh before retrying.
Source failures retain the last snapshot with an error; auth denial clears data.

## WKMS developer handoff

This contract assumes MAD and WKMS use the same PostgreSQL database. If that
changes, design a reviewed durable API/outbox protocol instead of claiming these
cross-database operations are atomic. The owner supplies its own effective-policy
storage/endpoint/authentication; the test-only sample is not a production migration.

On startup and when a requested version changes, WKMS must use one READ COMMITTED
transaction on one connection:

1. SELECT current request FROM `public.mad_task_limit_policy` WHERE singleton
   **FOR UPDATE**. Reread latest values after any wait; do not apply a cached request.
2. Activate that version/limit in WKMS's own durable claim-enforced policy table.
   Include the approved active-state/assigned-worker rules in its implementation.
3. Call `SELECT public.mad_confirm_task_limit(version, limit)` in that same
   transaction, then commit. Its function verifies the current request, refuses
   stale/mismatched versions with SQLSTATE40001, and stores idempotent confirmation.
   Any failed activation/confirmation must roll back both. Retry from a fresh
   request; do not acknowledge before committing enforcement.

Every WKMS claim/manual assignment/reassignment must authenticate its actor and use
the same lock order: requested policy row FOR SHARE, WKMS effective policy row
FOR SHARE, then the target worker's transaction advisory lock (or equivalent row
lock consistently used by **all** owner assignment paths). Canonicalize worker UUIDs for the lock key (e.g. `$1::uuid::text`) so case
variants cannot acquire different locks for the same worker. Fail closed if either
policy row is missing. Count the worker's current active tasks **after acquiring
that worker lock**, compare with effective
limit, then conditionally claim/update the still-available task and commit.
READ COMMITTED ensures a waiting claimant sees the previous claimant's commit.
REPEATABLE READ with an old count snapshot is unsafe; SERIALIZABLE needs complete
transaction retry. Lock multiple workers deterministically for reassignment.

Holding the policy row shared prevents an activation/confirmation crossing an
in-flight claim. Activate with the exclusive policy lock before the WKMS policy
lock. The shared/exclusive order must be identical everywhere to avoid deadlocks.
The initial default must be activated/confirmed too; fail closed if WKMS has no
initialized effective policy. While a change is pending, use the previous effective
policy, not the requested value. Completion/removal may reduce load; lowering a
policy alone never rewrites task history or existing assignments.

Reference only: `test/fixtures/wkms-task-limit-contract.ts` demonstrates this SQL
pattern with test-owned `wkms_effective_task_policy`/`wkms_tasks` fixtures. The
production build excludes test/. It does not supply a deployed WKMS claim API or
replace the owning service's authorization, assignment paths, retries or review.

## Maintenance and acceptance register

If PENDING persists, ask WKMS to inspect its request reader, activation transaction,
function EXECUTE privileges, locks and logs. MAD never force-confirms or rolls back
an owner's activation. Request a new version to revert a limit; do not edit/delete
history or decrement versions. Keep policy/history/confirmation data through app
rollbacks. Reconcile shared roles and owner storage before any schema change.

All cases below: High priority, actual result/status **NOT_RUN**, execution and
defect/evidence links pending. Preconditions: disposable PostgreSQL with separate
MAD/WKMS roles, seeded manager/worker/first-login sessions; never Neon production.

| Case / requirement            | Type / candidate tests                                                    | Input and expected result                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-MAD-045-AC1 / SRS6.3 rule3 | API/DB `test/task-limit.e2e-spec.ts`; frontend `test/task-limit.test.tsx` | Default requested3, pending save, exact version confirmation, duplicate ACK idempotence, rerun persistence and actor history                          |
| TC-MAD-045-AC2 / NFR-12       | API/DB and `src/settings/task-limit.spec.ts`; frontend BFF test           | Invalid integer/bounds/queries400, missing/invalid401, unauthorized403, stale409; policy unchanged and no forged MAD confirmations                    |
| TC-MAD-045-AC3 / SRS6.3 rule3 | API/DB plus test-only WKMS reference fixture                              | Reduction retains3 existing tasks; further claim denied; two claims at load1/limit2 yield exactly one success using worker serialization              |
| TC-MAD-045-FAILURE            | API/DB suite and frontend component tests                                 | WKMS ACK failure rolls back local activation; lost confirmation/source outage stays pending with last confirmed policy; UI retains conflicting drafts |
| TC-MAD-045-BFF                | Frontend `test/task-limit-bff.test.ts`                                    | Server-held sessions, CSRF protection, strict version/bounds/cohort/source validation, safe no-store responses                                        |

Run existing CI unit/component coverage and disposable integration. Critical service
branches90%, global/new-code lines/branches80%. No tests were run locally and these
targets are not measured results. The reviewed Vitest integrity hash change only
adds settings BFF coverage; other protected config hashes remain unchanged.

Repository-side MAD implementation and reference handoff are complete. Real WKMS
adoption/atomic assignment authorization, deployed confirmation, role grants,
CI/coverage and staging evidence remain required before full DDP-045 acceptance.
