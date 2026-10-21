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

## DDP-044 read integrity and acceptance register

The existing directory/read paths are completed without a UI, SQL, dependency or
environment change. Keep the existing auth/staff supplements and read grants.
Backend and BFF pagination accept decimal digit strings only; scientific notation,
hexadecimal, fractional and repeated values are invalid. Search is trimmed and
rejects control characters; percent/underscore remain literal substring characters.
The detail endpoint accepts no query fields, matching the browser BFF.

The backend explicitly projects public profile fields and validates UUID identity,
role/status filters, booleans, bounded labels, delivery state, safe integer versions,
nullable age/phone/NIC, duplicate IDs, total count and complete page size. Nullable
legacy profile fields remain nullable; an unknown delivery row is the documented
`none` state. Malformed source data returns sanitized503, never fabricated zero
accounts. Unknown/manager IDs return404; valid pages beyond the last retain their
matching total with an empty items array. Sorting remains lower(name), UUID.

The browser validates the same profile/page constraints and verifies requested ID,
page/pageSize and role/status against returned data. Extra credential, delivery
payload, lease and provider-error fields are discarded rather than forwarded.
No claim is made that an email marked sent reached the recipient: it indicates
provider acceptance only. Reads do not alter accounts, sessions or delivery state.

All cases below are High priority; actual result/status **NOT_RUN**, evidence and
defect links pending CI/staging. Preconditions: disposable PostgreSQL, existing
staff/auth schema, restricted MAD runtime role, seeded manager/worker/first-login
sessions, four-role profile and delivery fixtures. Never run against Neon.

| ID / requirements             | Type / candidate tests                                                    | Input and expected result                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-MAD-044-AC1 / MD-14/15/15b | API/DB `test/staff.e2e-spec.ts`; unit `src/staff/staff-directory.spec.ts` | Four supported roles, case-insensitive literal name/email/username searches, role/status filters and tied names: matching counts, deterministic UUID tiebreak and distinct pages |
| TC-MAD-044-AC2 / MD-16/16b    | API/DB and unit suites above; frontend `test/staff-bff.test.ts`           | Selected staff UUID: allowlisted editable profile plus delivery state, no password/hash/encrypted credential/lease/provider-error leakage                                        |
| TC-MAD-044-AC3                | API/DB suite above                                                        | Invalid/repeated pagination or detail queries400; unknown/manager IDs404; inactive filter retains deactivated staff; beyond-last page200 with truthful total                     |
| TC-MAD-044-SOURCE             | Unit/API/DB suites above                                                  | Duplicate, incomplete, inconsistent or malformed source pages503; denied delivery-table access503; successful and failed reads leave accounts unchanged                          |
| TC-MAD-044-AUTH               | API/DB suite; `src/common/security-boundaries.spec.ts`                    | Missing/invalid/expired tokens401; worker/first-login sessions403 on protected directory/detail reads                                                                            |
| TC-MAD-044-BFF                | Frontend `test/staff-bff.test.ts`, `test/staff.test.tsx`                  | Invalid queries rejected; wrong ID/filter/page and duplicate/partial source results503; realistic full pagination fixtures retain existing UI/draft behavior                     |

Run the existing backend/frontend CI coverage and real-database integration jobs.
Critical directory service branch target is90%; global/new-code targets remain80%.
Configuration/assertion presence is not measured coverage. Final CI, actual grants
and staging results remain required acceptance evidence. No tests or hosted SQL
were executed during DDP-044 completion.
