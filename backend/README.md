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
