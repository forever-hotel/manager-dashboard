# Manager dashboard backend

DDP-053: [demonstration, submission and staff handover package](delivery/DELIVERY_GUIDE.md).
Drafts/scripts are prepared; actual rehearsal, v1.0.0 publication and assessment/
handover approvals remain pending. No tests, seed/reset or release ran locally.

DDP-052: [manager UAT scenarios, triage and actual sign-off record](uat/UAT_GUIDE.md).
Prepared only: real manager/supervisor execution and approval remain pending.

DDP-051: [immutable release package, protected workflow and rollback rehearsal](../deploy/release/RELEASE_GUIDE.md).
Production is disabled until owner configuration/approval; no release or rehearsal
ran locally. Real platform hooks and two-minute recovery evidence remain pending.

DDP-050: [structured audit, diagnostics and recovery runbook](OPERATIONS_RUNBOOK.md).
Collector/retention, monitoring and backup templates require owner installation
and evidence. No tests, backups, restores or hosted schema changes ran locally.

DDP-049: [GHCR staging delivery, host setup and recovery](../deploy/STAGING_GUIDE.md).
Automatic develop deployment requires the documented protected Linux runner and
private host configuration; no deployment or hosted schema changes ran locally.

DDP-047: [opt-in API/socket load tools and performance verification](test/performance/README.md).
Profile prepared; no local tests/load executed. Staging measurements and owner
approval are required before performance acceptance.

DDP-046: [real-service verification pack](integration/DDP_046_VERIFICATION.md),
[case register](integration/acceptance-register.csv) and
[execution evidence record](integration/EVIDENCE.md).
Prepared only: staging is not ready; real-provider acceptance remains pending.

DDP-045: [task-limit settings, manual SQL and WKMS handoff](TASK_LIMIT_GUIDE.md).
MAD saves remain pending until real WKMS activation confirms their exact version.

DDP-044: [staff directory/read validation and acceptance register](STAFF_UI_GUIDE.md).
No additional SQL, environment or UI changes are required.

DDP-043: [persistent notifications, manual SQL and acceptance register](NOTIFICATIONS_GUIDE.md).
Apply the reviewed notification receipt supplement manually before using this feature.

[DDP-001 through DDP-042 source audit](DDP_001_042_AUDIT.md) records implementation
references and remaining acceptance/external-owner work. The prepared
[v0.1.0 gate](SPRINT_5_READINESS.md) remains unaccepted until CI/staging evidence.

DDP-042: [read-only worker task feed, deployment and acceptance register](OPERATIONS_GUIDE.md).
Existing UI is preserved; no additional SQL or environment changes are required.

DDP-040: [promotion publisher setup and proposed HW checkout contract](PROMOTION_SYNC_GUIDE.md).
Publication defaults disabled; review the new manual SQL before enabling it.

DDP-039: [reliable real-time transport and acceptance register](REALTIME_GUIDE.md).

DDP-038: [ownership and integration contract pack](contracts/DDP_038_CONTRACT_PACK.md),
[deterministic metric examples](contracts/DDP_038_METRIC_EXAMPLES.md) and
[decisions awaiting owner review](contracts/DDP_038_REVIEW_REGISTER.md).

NestJS provides manager authentication, staff management, analytics, promotions,
complaints, read-only operational feeds, exports and authenticated event delivery.

Start with the [clean-checkout developer guide](DEVELOPER_GUIDE.md),
[complete API/event reference](API_CONTRACT.md),
[MD requirement traceability](REQUIREMENT_TRACEABILITY.md),
[current contract decisions](CONTRACT_DECISIONS.md) and
[documentation changelog/verification register](CHANGELOG.md).

Use Node 22 and configure `backend/.env` from `.env.example` for direct development.
From this directory:

```powershell
npm ci
npm run build
npm run start:dev
```

For a compiled production start, use `npm run start:prod` after building.
For the whole local application, use root `docker compose up -d --build` instead.

Neon schema changes are managed externally. Keep `DB_SYNCHRONIZE=false` and
`DB_LOGGING=false`. The SQL files in `../deploy/` describe manual MAD prerequisites.
Existing manager accounts are never reset by initial-account provisioning.

Run `npm run lint`, `npm run format:check` and `npm run test:cov` for quality checks.
`npm run test:integration` requires `TEST_DATABASE_URL` pointing to a disposable
test database; never use the application's Neon database. Legacy migration helpers
under `src/database/` are retained because these test fixtures import them; the
standalone migration CLI and its npm command have been removed.

Detailed local references are in `../docs/guides/`, `../docs/implementation/`,
`../docs/testing/` and `../docs/schema-review/`. These folders are Git-ignored.

## Staff password reset (DDP-013)

`POST /mad/staff/:id/reset-password` requires a manager bearer token after the
manager's first password change. Send JSON `{ "version": 0 }` using the current
version from GET; the backend permits an omitted version for legacy callers,
but the dashboard BFF requires it. Success is HTTP 200 with
`{staffId, deliveryId, deliveryStatus: "pending"}`; credentials are never returned.
Unknown/non-staff IDs return 404, malformed UUIDs 400, inactive staff 409, missing
or invalid sessions 401, and unauthorized/first-login managers 403. Storage or
credential-encryption failures return 503 without committing a partial reset.

Reset generates a bcrypt temporary password, requires a first-login change,
increments `session_version`, clears lockout, and atomically replaces the account's
encrypted SendGrid delivery. Email retries reuse that password. Repeating the reset
request deliberately generates another password; after a network timeout, avoid
blindly retrying the POST. Failed email delivery alone is not a reason to reset again.

No new schema is required beyond the existing auth/staff SQL prerequisites.
A separate runtime database role needs UPDATE on `staff_users`, plus existing
SELECT/INSERT/UPDATE grants on `mad_staff_deliveries`; apply permissions manually.
No application startup SQL is introduced. Existing email environment settings apply.

Each subsystem owns its login: verify `is_active`, compare the token's credential
version with the database `session_version` on every protected request, and allow
only password change/logout when `password_change_required` is true. On change,
replace the hash, clear the flag and increment the version atomically. MAD does not
provide staff login or enforce these checks inside another subsystem.

The queue retains one current delivery per staff member. Reset replaces that row's
identity and clears the old encrypted payload. An email already being transmitted
can still arrive with an obsolete password; it cannot authenticate after the reset.
Application audit logs record actor ID, staff ID and reset outcome without secrets.
Retain those logs centrally if durable audit history is required.

Run `npm test -- --runInBand staff-reset.spec.ts` and
`npm run test:integration -- staff.e2e-spec.ts` to check the reset behavior using the
disposable database configuration described above.

## Staff profile maintenance (DDP-014)

Both endpoints require a current manager bearer token after the manager's first
password change. Manager accounts are excluded from the target staff profiles.

- `GET /mad/staff/:id`: returns the staff profile and its current integer `version`.
- `PATCH /mad/staff/:id`: requires that `version` and at least one mutable field.
  Returns HTTP 200 with the saved profile and incremented version.

Example PATCH body after GET returns version 0:

```json
{ "version": 0, "vocation": "Kitchen", "role": "KITCHEN_STAFF" }
```

Mutable fields: `name`, `vocation`, `email`, `age`, `phone`, `nic`, `role`, and
`isActive`. Validation/normalization matches staff creation. Omitted fields are
preserved; nulls, unknown fields and empty edits are rejected. `isActive` only
accepts `false`: this ticket supports deactivation, not reactivation. Roles remain
RECEPTIONIST, WORKER, KITCHEN_STAFF and KITCHEN_MANAGER; manager elevation, changing
usernames/passwords through PATCH, deletion and manager self-deactivation are
not supported. Deactivated records and their historical references are retained.

Responses contain `staffId`, `name`, `vocation`, `email`, `age`, `phone`, `nic`,
`username`, `role`, `isActive`, `passwordChangeRequired` and `version`. No hashes,
passwords, tokens, lockout internals or email ciphertext are returned.

Malformed UUIDs/fields return 400; unknown or manager target IDs return 404;
duplicate unique details and stale versions return 409; authentication failures
return 401/403. Storage/encryption failures return 503 with the edit rolled back.
Reload the profile after a conflict and ask the manager to reconcile the changes;
do not automatically retry using a new version.

The API reuses `session_version` as the edit version, avoiding a schema change.
Every accepted edit increments it, including profile-only or same-value edits,
so all existing staff sessions become stale. Password resets and password changes
also invalidate an open edit's version. Other subsystems must check the current
account's active flag, role and version on every protected operation; checking
only the JWT signature does not enforce this contract. Staff sign in again after
an edit. MAD enforces these checks for its own requests; verification of other
subsystems belongs to their owners.

Pending/failed credential messages are updated atomically to the edited email,
role and version using the same temporary password and a fresh delivery ID.
Deactivation cancels outstanding messages and removes their ciphertext. Completed
messages are retained. Already transmitted messages cannot be recalled. Profile
edits do not send replacement emails for messages already sent; use the explicit
reset endpoint if another temporary password is needed. Required DB permissions
are unchanged from DDP-013, and no startup SQL or new environment values are needed.

Audit logs record actor ID, staff ID, changed field names, saved version and outcome,
not profile values or credentials. Retain application logs for audit history.
Unit tests: `npm test -- --runInBand staff-profiles.spec.ts`.
API/database tests: `npm run test:integration -- staff.e2e-spec.ts` with a disposable
test database. These tests were added but not executed during implementation.

## Revenue and combined analytics (DDP-056 / DDP-015)

Manager-only GET `/mad/analytics/revenue?period=day|week|month` returns completed-
payment revenue; GET `/mad/analytics/overview?period=day|week|month` returns
`{bookings,revenue}` with identical calendar boundaries and reporting timestamp.
These use the existing manager guard, including mandatory password change.
Invalid period/unknown query fields return 400; absent/invalid auth 401; denied
role or mandatory password change 403; missing/denied/invalid sources 503.

Approved policy (2026-10-15): sum `public.payments.amount` as LKR integer cents
where `payment_status='COMPLETED'`, grouped by `paid_at`. REFUNDED, FAILED and
PENDING records are excluded. This is **completed-payment revenue**, not net
cash-flow accounting: the schema has no refund event amount/date. A later status
change to REFUNDED removes that payment from its original period's revenue.
No booking totals, joins or foreign-currency conversion are used. Each payment
primary key is counted once; multiple payments for one booking remain separate.

Periods are whole calendar days, Monday-start weeks or months in Asia/Colombo,
with half-open boundaries `[start,end)` serialized as UTC ISO timestamps. Compare
the full current calendar period with the immediately preceding calendar period,
not elapsed portions. The UI labels the current period as in progress. Revenue
SQL uses numeric arithmetic and rounds `(current-previous)*100/previous` to two
decimal places. When previous revenue is zero, `percentageChange` is null and
`percentageUnavailableReason` is `PREVIOUS_REVENUE_ZERO`, including when both
amounts are zero. Otherwise the reason is null. Zero current with positive previous
revenue returns -100%. Fields `currentMinor` and `previousMinor` are safe integer
cents; unsafe totals, malformed completed payments (including missing paid_at),
and storage errors return 503 rather than fabricated zero revenue.

The response also contains `period`, `timezone`, `currency: "LKR"`,
`metric: "completed_payment_revenue"`, `comparison: "whole_calendar_period"`,
`asOf`, `start`, `end`, `previousStart`, and `previousEnd`. The reporting timestamp
aligns period selection across both metrics, not a transactionally frozen snapshot
of independently changing source data.

The hosted shared schema already defines payments. No migration or startup SQL
was added. If using a limited runtime role, the database owner must manually grant
SELECT on `public.payments` to that role (substitute its actual name):
`GRANT SELECT ON public.payments TO your_runtime_role;`. No grant was executed.
Existing booking reporting-view permissions are still required.

Tests added, not run: `npm test -- --runInBand revenue-analytics.service.spec.ts`
and `npm run test:integration -- bookings.e2e-spec.ts` (disposable database only).

## DDP-018: promotion creation and lookups

Manager-only endpoints (the existing JWT guard also requires first-login password
change completion):

| Method | Path                                          | Result                                                 |
| ------ | --------------------------------------------- | ------------------------------------------------------ |
| POST   | /mad/promotions                               | 201 saved promotion and derived lifecycle              |
| GET    | /mad/promotions?page=1&pageSize=20            | Paginated promotions, newest first with UUID tie-break |
| GET    | /mad/promotions/:id                           | Promotion, or 404 for unknown UUID                     |
| GET    | /mad/promotions/room-types?page=1&pageSize=20 | Eligible room types sorted by name/UUID                |

Pagination defaults to page 1, size 20; size is capped at 100 and page at 1,000,000.
Malformed UUIDs, duplicate query parameters and unexpected fields return 400.
Missing/invalid sessions return 401; disallowed roles and first-login accounts return 403. Database/source errors return sanitized 503, never invented empty results.
All HTTP responses retain the application's no-store policy.

Example POST JSON (replace the example UUID with an ID from the room-type lookup):

```json
{
  "code": "AUTUMN_26",
  "discountType": "PERCENTAGE",
  "discountValue": 25,
  "validFrom": "2026-10-01T00:00:00+05:30",
  "validUntil": "2026-11-01T00:00:00+05:30",
  "roomTypeIds": ["11111111-1111-4111-8111-111111111111"],
  "maxRedemptions": 100
}
```

Approved contract for HW coordination: codes are trimmed, ASCII and uppercase,
1-50 characters, starting with an alphanumeric character; subsequent characters may
also be underscore or hyphen. Values and redemption limits are positive integers.
PERCENTAGE is 1-100; FIXED_AMOUNT is LKR integer cents, at most 2,147,483,647.
There must be 1-100 unique existing room-type IDs. Unknown IDs return 400.
Creation of the promotion and all associations is atomic. Duplicate normalized
codes return 409, including concurrent requests. No room-type writes are needed.

Validity timestamps must include seconds and Z or an explicit offset (up to three
fractional-second digits). Start is inclusive, end exclusive, and end must be later.
Use +05:30 for hotel-local midnight; responses serialize equivalent UTC instants.
No date-only or implicit server-local timestamps are accepted.

Stored status is ACTIVE on creation. Derived lifecycle precedence is INACTIVE,
EXHAUSTED, EXPIRED, SCHEDULED, ACTIVE; comparisons use one clock instant per response.
A future promotion is SCHEDULED even though its stored enabled status is ACTIVE.
Fixed discounts must floor the final payable amount at zero in redemption consumers;
this ticket only creates and reads promotions, and does not redeem or price bookings.
Lifecycle editing and logical deletion are implemented by DDP-019 below; redemption remains a separate ticket. Existing frontend
mock content and styling are unchanged; these endpoints are ready for later UI wiring.

### Manual database prerequisite

Use the corrected shared schema: mad_promotion_codes, mad_promotion_room_types and
room_types. The normalized junction table replaces the obsolete UUID-array column.
Have the database owner review/apply deploy/neon-mad-promotions.sql manually to add
case/whitespace-normalized uniqueness, and grant the actual runtime role SELECT/INSERT
on both MAD promotion tables plus SELECT on room_types. The grant examples in that
file are comments requiring your actual role name. No schema changes run at startup.
The index intentionally fails if legacy normalized duplicates exist: review them
before retrying, without silently merging records or redemption history.
The historical foundation migration alone is not a substitute for this corrected schema.

Tests: src/promotions/promotions.spec.ts and test/promotions.e2e-spec.ts. Integration
uses a newly created disposable PostgreSQL database and the corrected schema fixture,
not Neon. CI discovers both files automatically. Promotion service branch coverage is
required at 90%; existing overall 80% line/branch requirements are retained. Tests
were authored but not run locally at the user's request. Run npm run test:cov and
npm run test:integration in CI before marking the ticket verified.

## DDP-019: versioned promotion lifecycle and durable publication

The UI is unchanged. Manager-only mutation endpoints return HTTP 200 and the saved
promotion including `version`, `deletedAt`, `lifecycleState` and `publicationStatus`:

| Method | Path                           | Body                                                     |
| ------ | ------------------------------ | -------------------------------------------------------- |
| PUT    | /mad/promotions/:id            | All DDP-018 editable fields plus current integer version |
| POST   | /mad/promotions/:id/activate   | { "version": 0 }                                         |
| POST   | /mad/promotions/:id/deactivate | { "version": 0 }                                         |
| DELETE | /mad/promotions/:id            | { "version": 0 }                                         |

Fetch the current promotion first. New promotions start at version 0; every successful
mutation increments it once. A transaction locks the row before checking the supplied
version. Concurrent requests using the same version have one winner; stale versions
return 409 without overwriting it. Unknown IDs return 404; invalid fields return 400.
Missing/invalid sessions return 401; unauthorized/first-login managers return 403.
PUT is a complete replacement of editable fields, not a partial PATCH. It preserves
current redemptions and status. A redemption limit cannot be lowered below completed
redemptions. Activation of an expired or exhausted offer returns 409; future valid
offers can be enabled but remain SCHEDULED until their start. Repeated actions need
the new version. Version overflow is rejected rather than wrapping.

Approved logical deletion policy: all deletions preserve the promotion, room-type
links, redemption count, booking references and saved booking amounts. Deletion
sets INACTIVE plus deletedAt, returns DELETED, and permanently reserves the code.
Deleted offers are omitted from the default list but remain readable by ID for audit;
edit/reactivation/repeated deletion return 409. No booking/history rows are rewritten.
The database constraint also prevents an inactive tombstone being marked ACTIVE.

Creation and every lifecycle mutation atomically insert an immutable snapshot into
mad_promotion_outbox. Keys are event_id (UUID) and unique (promo_id,promotion_version).
Events are promotion.upsert or promotion.deleted; deletion snapshots explicitly carry
INACTIVE and deletedAt. A failed outbox insert rolls back the entire mutation, including
room-type replacement. No network call takes place inside the transaction.

PENDING means unacknowledged publication work exists; NO_PENDING_WORK only means the
queue has no unacknowledged rows for this promotion, not proof of website delivery.
Existing promotions without historical outbox events also report NO_PENDING_WORK.
DDP-040 must deliver/retry these events, use event_id for idempotency, reject older
versions (including late upserts after a tombstone), acknowledge only successful
applications, and reconcile legacy offers. This ticket does not claim that HW has
already removed an offer. Consumers must validate live eligibility before redemption.
No publisher, automatic expiry scheduler or redemption logic is added here.

### Manual rollout

Before running this backend version, have the database owner review/apply
`deploy/neon-mad-promotion-lifecycle.sql` after the DDP-018 schema/index prerequisites.
It adds version/deleted_at, the tombstone invariant and the durable outbox. Use its
commented grant examples with the actual runtime role. Never run the full shared
schema over an existing database. No SQL is applied automatically at startup and no
Neon changes were executed during implementation. The publisher's acknowledgement
permissions belong to its own role/configuration under DDP-040.

Unit tests extend src/promotions/promotions.spec.ts. Disposable-PostgreSQL integration
cases in test/promotions.e2e-spec.ts cover all mutations, stale concurrent requests,
history preservation, authorization, validation, eligibility and queue-failure rollback.
Tests are authored but not run locally; CI coverage and staging verification remain
required. The existing 90% promotion-service branch threshold is unchanged.

## DDP-020 promotion UI contract additions

`POST /mad/promotions` accepts optional `status: ACTIVE | INACTIVE` (default ACTIVE).
INACTIVE creates a draft and its inactive outbox snapshot in the same transaction;
it never briefly publishes an active offer. `PUT` still rejects status changes;
use the version-checked activation/deactivation endpoints instead.

Promotion responses now also report `publicationStatus: FAILED` when any
unacknowledged outbox row has a non-null last_error. Worker error details are never
returned. Otherwise PENDING / NO_PENDING_WORK retain their DDP-019 meaning.
Delivery confirmation and retry processing remain DDP-040 work, not inferred by
this UI. This uses existing outbox columns, with no new SQL or environment changes.
Draft creation and safe failure visibility have additional unit and disposable-DB
integration cases, authored but not run locally.

## DDP-021 complaint register and resolution

Manager-only endpoints (completed first-login password change required):

| Endpoint                    | Contract                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /mad/complaints`       | Paginated register; `page` defaults to 1, `pageSize` to 20 (maximum 100). Optional exact `status`, trimmed case-sensitive `category`, and UUID `workerId` filters combine with AND. |
| `GET /mad/complaints/:id`   | Complaint plus private, version-ordered manager history.                                                                                                                            |
| `PATCH /mad/complaints/:id` | `{ "version": 0, "status": "UNDER_REVIEW", "note": "Investigation started" }`; returns the saved complaint object and incremented version.                                          |

Register and PATCH responses contain `id`, `category`, `description`, nullable
`referencedWorkerId`, `submittedAt`, `status`, nullable `resolvedAt`, and `version`.
Dates are UTC ISO timestamps. Detail adds `history` entries containing `version`,
`fromStatus`, `status`, `note`, `actorId`, and `recordedAt`. List and PATCH responses
never contain notes. All endpoints require manager authentication and are no-store.
Unknown records return 404, invalid input/transitions 400, and stale versions 409.
Unauthorized/forbidden access returns 401/403 with the existing error envelope.

Approved transitions are strictly SUBMITTED -> UNDER_REVIEW -> RESOLVED, with a
nonblank trimmed internal note (1–4000 characters) and current integer version on
each transition. No skipping, reopening, repeating a state or note-only updates.
Unmanaged/legacy records start at version 0; no history is fabricated. Actor comes
from the authenticated session and time from the server, never from request fields.

FOSS owns creation and guest fields. The approved field-level contract permits MAD
to update only `foss_complaints.status` and `resolved_at`. Shared `resolution_notes`
is neither read nor written. New notes and audit history reside in private
`mad_complaint_history`; versions in `mad_complaint_state`. An owner-row lock followed
by a fresh version read serializes concurrent writers. Status/version/history and
the durable event insert commit atomically; failures roll everything back.

`mad_complaint_outbox` carries note-free `complaint.status_changed` events:
`complaintId`, `version`, `previousStatus`, `status`, nullable `referencedWorkerId`,
and `occurredAt`. Later notification/worker-count consumers must use event ID for
idempotency and version ordering. Publishing and consumer delivery are not added
by this ticket; the owner table already exposes current status to authorized readers.
Worker open-complaint counts should count SUBMITTED/UNDER_REVIEW, excluding RESOLVED.

Before deployment, the database owner must review/apply
`deploy/neon-mad-complaints.sql` after the shared schema and apply its grants to a
dedicated MAD runtime role. Coordinate exclusive resolution-field ownership with
FOSS. Guest/FOSS runtime roles must not own or inherit privileges on MAD's private
tables. A shared owner/superuser connection cannot provide this isolation. Do not
copy internal notes into shared notes, guest responses or events. Existing legacy
shared notes are untouched; their visibility remains the FOSS owner's responsibility.
No SQL runs at startup, and no hosted SQL was applied during implementation.

Tests: `src/complaints/complaints.spec.ts` and `test/complaints.e2e-spec.ts` cover
validation, transitions, filters, history, concurrency, permissions, privacy and
rollback. Integration uses an isolated PostgreSQL database and a restricted runtime
role, plus a separate guest-like role to verify private-table access denial. No
FOSS application is mocked as proven compatible: real FOSS staging verification
and CI test/coverage results remain required. Existing UI is unchanged (DDP-022).

## DDP-023 food-order analytics

`GET /mad/analytics/food-orders?period=day|week|month` requires an authenticated
manager after first-login password change. Omitted period defaults to day, matching
the other analytics endpoints. Invalid/duplicate periods or unknown query keys
return 400; missing/invalid sessions return 401 and disallowed roles return 403.

The report uses current calendar periods in Asia/Colombo, Monday-start weeks,
inclusive start and exclusive end. Orders are attributed by `placed_at`. Current
PLACED, IN_PREPARATION, READY and DELIVERED orders count; CANCELLED orders are
excluded from all totals, quantities and peak hours. A later cancellation restates
the original placement period rather than creating a negative cancellation bucket.
These are full calendar periods, not rolling intervals or elapsed-only comparisons.

Response fields:

- `period`, `timezone`, `weekStartsOn`, `metric`, `includedStatuses`, `start`, `end`,
  `asOf`: explicit reporting policy and server-clock bounds.
- `total`: unique qualifying orders, counted independently of line items. Orders
  with no items still count once.
- `trend`: every calendar day in the selected period, `{ date, count }`.
- `hours`: all 24 hotel-local hours, `{ hour: 0..23, count }`, aggregated across
  that period. `peakHours` contains all positive maximum-count hours ascending;
  it is empty when no orders qualify.
- `popularItems`: top 10 `{ menuItemId, name, quantity }` entries grouped by menu
  item ID and historical line-item name, ordered by quantity descending, name in
  PostgreSQL C collation ascending, then UUID ascending. Renamed items retain
  separate historical-name groups; current menu names are never substituted.
  `itemLimit` and `itemGrouping` state this policy. Ties at the cutoff use the same
  deterministic order rather than returning an unbounded set.
- `freshness`: query timestamp and latest source order/line-item update timestamp
  among period candidates (including cancelled records); null if there are none.

The source contract is read-only `kms_food_orders` and `kms_food_order_items`, using
the supplied shared schema's order/item primary keys and item snapshot fields. One
parameterized SQL statement gives a consistent snapshot; order counts never use an
item-expanded join. Only aggregate/item identity/name fields are returned, with no
booking, guest, room, allergy or special-note data. Counts are checked for safe
integer representation. Missing sources, denied grants, malformed results or DB
outages produce 503, never a fabricated empty report. Responses are no-store.

No schema change or new environment setting is required. If the dedicated MAD role
lacks reporting reads, the database owner can adapt the commented column-level
grants in `deploy/neon-mad-food-analytics.sql`; no grants execute automatically.
Coordinate cancellation/ranking rules with KMS/FOSS before cross-service acceptance.
There are no writes to either owner's data and no frontend changes in this ticket.

Tests: `src/analytics/food-analytics.service.spec.ts` and
`test/food-analytics.e2e-spec.ts`. Integration creates an isolated PostgreSQL database
with reporting-schema fixtures and a role limited to the required source columns.
Tests are authored but not run locally; CI coverage and real staging acceptance
remain pending. The food service has a 90% branch coverage gate.

## DDP-024 service-request analytics

`GET /mad/analytics/service-requests?period=day|week|month` requires a manager
session with first-login password change completed. The default period is day.
Invalid/duplicate periods and unknown query keys return 400; missing/invalid
sessions return 401, and disallowed roles or first-login sessions return 403.

Calendar periods use Asia/Colombo, Monday-start weeks, inclusive start and
exclusive end. These are full calendar periods, not rolling intervals. Three
independent cohorts prevent confusing throughput with outstanding work:

- `total`, `trend` and `byStatus`: requests submitted within the period, using
  `submitted_at`. Trend contains every local calendar day, including zeros;
  status counts always include SUBMITTED, ASSIGNED, IN_PROGRESS and COMPLETED.
- `resolution`: currently COMPLETED requests whose `completed_at` falls in the
  period, including requests submitted before the period. `completedCount` counts
  this cohort; `validDurationCount` counts its nonnegative durations and is the
  average denominator. `excludedCount` is their difference. `averageMinutes` is
  elapsed completion-minus-submission time in minutes, rounded to two decimals.
  With no valid durations the average is null, not zero. A genuine zero-duration
  completion remains zero. Without completions both counts are zero.
- `backlog.count`: currently SUBMITTED, ASSIGNED or IN_PROGRESS requests across
  all dates, with submission at or before `asOf`. This is current source state,
  not a historical reconstruction or the unresolved subset of the selected period.

`dataQuality` flags negative completed durations, missing completion timestamps
and unexpected timestamps on open requests, with separate counts and OK/WARNING
status. Its scope is all source records, independent of the selected period.
Negative durations are excluded from the average. Missing completion timestamps
cannot be assigned to a completion period; they remain visible in global quality
counts. A period containing only invalid completions therefore has a positive
completed count and null average. Current-state edits can restate past totals.

Metadata includes `period`, `timezone`, `weekStartsOn`, `start`, `end`, `asOf`,
cohort labels and `freshness` (query time and latest source update across all
requests, null when empty). One parameterized SELECT gives a consistent snapshot
of `public.foss_service_requests`; no booking/room/guest/description data is
returned and WKMS tasks are not used. Unsafe numeric results, missing sources,
denied permissions or database failures return a sanitized 503, not zero metrics.
All responses are no-store.

No migration, environment change or UI change is required. A restricted MAD role
needs SELECT on `request_id`, `status`, `submitted_at`, `completed_at`, `updated_at`.
The database owner may adapt the commented optional grants in
`deploy/neon-mad-service-analytics.sql`; nothing executes at startup. Coordinate
the reporting contract with FOSS before cross-system acceptance.

Tests: `src/analytics/service-request-analytics.service.spec.ts` and
`test/service-request-analytics.e2e-spec.ts`. The latter uses a real disposable
PostgreSQL database and a restricted runtime role. Tests are authored, not run
locally; CI results, coverage and real staging verification remain pending.
The analytics service has a 90% branch coverage gate.

## DDP-025 worker-performance analytics

`GET /mad/analytics/worker-performance?period=day|week|month&workerId=<uuid>`
requires a manager session after first-login password change. Both filters are
optional: period defaults to day and omission of workerId returns all eligible
workers. Invalid/duplicate filters and unknown keys return 400; missing/invalid
sessions return 401 and disallowed roles/first-login sessions return 403. An
unknown valid worker ID returns an empty `workers` array, not a fabricated worker.

The worker population includes current WORKER-role staff and staff referenced by
any retained WKMS task, including inactive staff and former workers promoted to
other roles. Staff with no tasks remain present when their current role is WORKER.
Results use stable `workerId` values ordered ascending, not names as identifiers.
Names, roles and active flags reflect current staff records. No pagination is
applied to this aggregate staff report.

`period`, `timezone`, `weekStartsOn`, `start`, `end` and `asOf` describe the current
full calendar day/week/month in Asia/Colombo, with Monday weeks and [start,end)
bounds. Per-worker metrics are:

- `completedTaskCount`: current COMPLETED tasks attributed by `completed_at` in
  the period, irrespective of submission date. Uses retained WKMS tasks and
  `assigned_worker_id`; service requests are not substituted for worker tasks.
- `averageCompletionMinutes`: elapsed `completed_at - submitted_at`, rounded to
  two decimals. The schema has no work-start timestamp, so this includes waiting
  time and must not be presented as hands-on work time. Negative durations are
  excluded. `validDurationCount` is the denominator; `excludedDurationCount` is
  the difference from completed count. Without valid durations the average is
  null; a genuine zero-minute completion remains zero.
- `openComplaintCount`: currently SUBMITTED/UNDER_REVIEW FOSS complaints directly
  referencing this worker, submitted on/before `asOf`, across all dates. Resolved,
  future-submitted and unreferenced complaints do not count. No worker is inferred
  from a complaint's order or service request. DDP-021 resolution is reflected
  on the next read.
- `dataQuality`: OK/WARNING and negative-duration, missing-completion and
  unexpected-completion timestamp counts across all tasks assigned to that
  returned worker. Missing completion times cannot enter a completion period.

Task and complaint aggregates are computed independently before joining to staff,
preventing task-by-complaint count multiplication. A single parameterized SELECT
provides a consistent snapshot. Response cohort/unit labels make these policies
explicit. `freshness` reports query time and the greatest update time across the
selected staff and all task/complaint sources (null if those sources are empty).
No credential, contact, guest, complaint narrative or task-description fields are
read by this query or returned. Responses are no-store; missing/denied sources or
invalid numeric results return sanitized 503 rather than fabricated zero reports.

Attribution follows the retained task's current assignee: the shared schema has no
immutable completion-assignee history. WKMS must retain completed tasks and their
assignee to preserve historical reporting. Post-completion reassignment or source
correction restates these metrics. Coordinate this contract with WKMS and FOSS.

No schema, environment or UI changes are required. Optional commented read grants
are in `deploy/neon-mad-worker-analytics.sql`; only a database owner should adapt
them for a restricted MAD role. No grants or SQL run automatically at startup.
Tests are in `src/analytics/worker-performance.service.spec.ts` and
`test/worker-performance.e2e-spec.ts`, with a 90% service branch coverage gate.
They are authored but not run locally. CI coverage and real provider staging
verification remain pending.

## DDP-026 / DDP-039 / DDP-041 kitchen overview

The manager-only kitchen snapshot API and durable RabbitMQ-to-Socket.IO kitchen
transport are implemented. See [setup and producer contract](KITCHEN_REALTIME_GUIDE.md)
for manual SQL, local Compose settings, the KMS handoff, recovery behavior and
outstanding staging/scaling verification. No tests or hosted SQL were run locally.

## DDP-027 room status

`GET /mad/rooms/status` provides manager-only read-only room snapshots. Versioned
`room.status.changed` updates reuse the authorized socket transport with a separate
durable queue and watermark store. See [the room contract and setup](ROOM_STATUS_GUIDE.md)
for manual SQL, source ownership, FDS publishing and pending acceptance checks.

## DDP-035 security review

See [the security review and acceptance register](SECURITY_REVIEW.md) for endpoint
inventory, hardening, dependency findings and pending CI/staging evidence.
No tests or hosted database changes were executed locally.

## DDP-036 Sprint 6 acceptance

See [Sprint 6 readiness](SPRINT_6_READINESS.md) for the 58-row acceptance register,
missing prerequisites, CI requirements and unpublished v0.2.0 review pack.
The acceptance gate remains open until actual CI/staging evidence is attached.
