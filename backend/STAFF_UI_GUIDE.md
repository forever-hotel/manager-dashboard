# Staff management ? DDP-029 / prerequisite DDP-044

The Staff page now uses authenticated backend data instead of mock accounts. Its
existing typography, colors, form/table layout and controls are reused. All seven
profile fields are editable: full name, role, vocation, email, phone, NIC and age.
Supported roles: Receptionist, Worker, Kitchen Staff and Kitchen Manager.
Manager accounts are excluded from this directory.

## Setup

No new SQL or environment variables are required. The shared staff schema and
existing `neon-mad-auth.sql` / `neon-mad-staff.sql` supplements must already exist.
Application startup does not apply SQL. The MAD runtime role needs its existing
staff SELECT/INSERT/UPDATE privileges and delivery-table privileges.

Use the existing STAFF_CREDENTIALS_KEY and SendGrid settings. With email disabled,
creation/reset succeeds but delivery remains pending. Keep the encryption key
stable while queued credentials exist. Never display decrypted credentials.
The delivery worker retries failed sends. Check verified sender, API key, delivery
worker logs and recipient email when delivery fails. Correcting a profile email
rebinds a pending/failed delivery through the existing backend logic. Do not reset
a password merely to retry an email unless the manager intends to replace it.

## Directory contract

`GET /mad/staff?search=kamani&role=WORKER&status=active&page=1&pageSize=20`

- Optional search: trimmed, maximum 100 characters, case-insensitive literal
  substring over name/email/username. `%` and `_` are literal, not SQL wildcards.
- Optional role: one of the four supported source role codes.
- Optional status: `active` or `inactive`; omitted means both.
- Page: 1?100000, default 1. Page size: 1?100, default 20.
- Sort: lower(name), staffId. A single statement returns matching rows and count.
- Response: `{items,total,page,pageSize}`. Each item contains only staffId, name,
  vocation, email, age, phone, NIC (`nic`), username, role, isActive,
  passwordChangeRequired, version and deliveryStatus.
- `GET /mad/staff/:id` returns the same safe profile plus deliveryStatus. Unknown
  and manager IDs return 404. Existing PATCH responses retain their original
  profile shape; subsequent directory/profile reads include deliveryStatus.
- Missing/invalid session: 401; worker/first-login restricted session: 403;
  invalid/unknown list filters: 400; unavailable database: sanitized 503.
- `deliveryStatus`: `pending`, `failed`, `sent`, `cancelled`, or `none`. `sent`
  means the provider accepted the message, not proof it reached the recipient.
  No password, hash, encrypted credentials, leases or provider error bodies leak.

## UI operations

The page supports create, edit/role change, password reset and deactivation.
Create/reset queue credentials for email delivery; the browser never receives
plaintext passwords. Reset and deactivation require named-account confirmation.
There is no reactivation API in the current backend, so no fake Activate control.
No last-login timestamp is stored by this contract: the column says Not recorded.
Day/week/month controls remain visible but disabled for the current directory.

Search and role/status filters reset pagination to page 1. The directory refreshes
after successful writes, through Refresh directory, and every 15 seconds to pick
up delivery changes. Background refresh does not replace an in-progress form.
Errors keep draft inputs. Search/filter changes do not discard the draft.

Edits and deactivation use the selected session/profile version. The UI also
supplies `version` to password reset. Reset validates it while holding the account
row lock, before any credential writes. For compatibility, existing internal API
callers may still omit reset version; the browser BFF requires it. A stale write
returns 409. Reload current version and keep draft fetches fresh profile details
and preserves the draft, with current values shown for deliberate review before
resubmission. A duplicate email/NIC conflict requires correcting those values.

After a timeout, refresh the directory to establish whether creation succeeded
before retrying. Mutations are not automatically retried. Account/session changes
continue to invalidate old sessions under the existing backend contract.

The Next.js `/api/staff/[[...path]]` proxy validates routes, filters and bodies,
checks same origin for writes, enforces payload limits, strips response extras,
and keeps the session cookie/token server-side. Responses are no-store.

## Verification

Tests authored but NOT RUN locally (user instruction):

- `backend/src/staff/staff-directory.spec.ts`: directory query/validation/failures.
- `backend/src/staff/staff-reset.spec.ts`: stale reset guard before writes.
- `backend/test/staff.e2e-spec.ts`: real disposable PostgreSQL directory, all roles,
  search/filter/pagination, delivery projection, 400/401/403/404, stale version
  resets and existing create/edit/deactivate delivery behavior. Never use Neon as
  TEST_DATABASE_URL; the suite creates and removes its own isolated test database.
- `frontend/test/staff-bff.test.ts`: protected proxy, CSRF, payload validation,
  credential stripping and sanitized upstream errors.
- `frontend/test/staff.test.tsx`: creation, fields/roles, confirmed actions, edit,
  stale draft retention, filters, paging, delivery status and failure/retry.

Run existing CI unit/coverage, integration and browser jobs. Passing tests,
coverage, real SendGrid delivery and staging acceptance remain pending evidence.
No commits or pushes are performed by this implementation task.
