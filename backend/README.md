# Manager dashboard backend

NestJS provides manager login, forced first-password change, session revocation,
staff account provisioning with SendGrid delivery, and booking/occupancy analytics.

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
manager's first password change. Send no body. Success is HTTP 200 with
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
