# Sprint 6 staging review procedure

Status: NOT RUN. Record candidate/baseline SHAs, staging URL, date, operator,
actual provider versions, CI URL and test-data IDs before execution. Use approved
test accounts/data; never paste passwords, session cookies, temporary credential
emails or guest personal data into evidence. Use redacted screenshots/traces.

## STG-036-PROMOTIONS

Maps to DDP-018/019/020/040 and TC-MAD-036-AC3. Requires the actual HW integration,
not a mocked website or manually marked outbox row. Currently blocked by DDP-040.

1. As a manager, create a draft with valid code, discount, hotel-local dates,
   usage limit and room scope. Verify the persisted list/detail fields.
2. Edit using the displayed version, activate and observe pending publication.
   Wait for actual delivery/acknowledgement and verify eligible website behavior
   against the agreed HW contract; record code/version and correlation/event ID.
3. Deactivate and logically delete separate fixtures; confirm website withdrawal
   and retention of manager history. Confirm deleted records cannot reactivate.
4. Repeat with invalid dates/discounts, duplicate code and a stale edit from a
   second browser. Verify actionable errors and retained draft values.
5. Interrupt the provider, make a change, and verify pending/failed does not claim
   website availability. Restore it; verify eventual correct version and no
   duplicate effects after replay.

Expected: saved state, publication state and actual HW availability agree under
the approved contract. Attach redacted manager/HW evidence and provider receipts.
Actual: NOT RUN. Evidence/defect: pending.

## STG-036-COMPLAINTS

Maps to DDP-021/022 and TC-MAD-036-AC3. Requires an actual FOSS-created test
complaint, one worker-linked fixture and one with no referenced worker.

1. Browse/filter/page the register and verify required fields and empty states.
2. Open detail and save SUBMITTED -> UNDER_REVIEW -> RESOLVED with an internal
   note and current version. Verify register/detail persistence after reload,
   resolved time, manager history and authorized source fields in FOSS.
3. With a second manager session, attempt a stale update. Confirm conflict,
   retained note and deliberate reload; attempt reopening and confirm rejection.
4. Simulate request failure; confirm no false success or discarded draft. Check
   missing/expired/WORKER sessions, invalid and nonexistent IDs, and unexpected
   fields. Verify no internal notes in unauthorized responses/logs/events.

Expected: only allowed transitions persist; history/internal notes remain
manager-only. Notification clearing belongs to its owning integration scope and
must not be claimed here without evidence. Actual: NOT RUN. Evidence/defect: pending.

## STG-036-STAFF

Maps to DDP-029/044, existing staff backend tickets, and TC-MAD-036-AC3.
Repeat the full matrix for RECEPTIONIST, WORKER, KITCHEN_STAFF and KITCHEN_MANAGER.
Coordinate each owning subsystem's login contract; no central login is assumed.

1. Create a unique complete test profile and verify persisted directory/detail
   fields and delivery state. Confirm actual verified-provider email delivery;
   queued/sent UI state alone is not a first-login demonstration.
2. Using the owning subsystem, verify temporary login requires password change,
   the new password works subsequently and restart does not restore the initial
   password. Keep credentials out of evidence.
3. Edit profile/change role, then verify current data and session invalidation in
   the appropriate subsystem. Reset password and repeat the mandatory-change
   flow. Deactivate a separate active fixture and verify old sessions/new login
   are denied. Never reactivate a deactivated account via an unsupported action.
4. Exercise duplicate email, invalid fields, unavailable email provider, stale
   profile/reset versions and denied manager-account mutation. Confirm retained
   input, truthful delivery state, no duplicate account and no plaintext secrets
   in API responses, logs or downloads.

Expected: all four roles work with their actual owners; unsupported external
session invalidation is a blocker to record, not an assumed pass.
Actual: NOT RUN for all four roles. Evidence/defect: pending.

## STG-036-OTHER

Execute the remaining acceptance-register rows, including independent analytics
aggregation/zero/N/A values, period/race/retry states, read-only room/kitchen/task
APIs, authorized stock persistence/recovery/duplicate/DLQ behavior, task-limit
enforcement including concurrent WKMS claims, and low-demand promotion prefills
without autosaving. DDP-045 and DDP-057 are currently missing. Do not mark later
Sprint 7 frontend boards or exports accepted as part of this review.

For each row record expected versus actual, status, date/SHA, evidence URL and
real defect link. Rerun failed/affected cases after remediation. Stop release
approval for missing features, missing providers, unresolved failures or absent
evidence; do not fabricate successful demonstrations.
