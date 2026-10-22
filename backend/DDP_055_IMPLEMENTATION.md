# DDP-055: temporary credential email delivery

Implementation is ready for CI; real SendGrid acceptance and mailbox evidence remain pending. No tests or hosted database operations were run locally.

## Delivery contract

Authorized manager provisioning and reset transactions queue an AES-256-GCM encrypted payload bound to its delivery ID. Ordinary account fields contain a cost-12 password hash, never the temporary password. Manager responses and staff directory reads expose identifiers and delivery state, never credentials. Each subsystem still owns its login and mandatory first-password-change enforcement.

The worker claims one due row using a 60-second lease and `SKIP LOCKED`. SendGrid requests time out after eight seconds and accept only HTTP 202. `sent` means **provider accepted**, not delivered to the recipient. No webhook or confirmed-delivery state is claimed. Provider response bodies and exceptions are not stored or logged.

Retries reuse the same encrypted payload and account; they never create accounts or reset passwords. There are at most five attempts per delivery. Failure delays are 30, 60, 120 and 240 seconds, subject to the 15-second worker interval. A fifth failure becomes terminal `cancelled` with `EMAIL_RETRY_EXHAUSTED` and clears ciphertext. A crashed fifth attempt is terminal after its lease expires. Cancellation also prevents sending obsolete credentials after deactivation, first-password change or a credential-version change.

Payloads expire 24 hours after the delivery row's `created_at`. The worker purges expired, unleased payloads on each tick even when `STAFF_EMAIL_ENABLED=false`; an active lease is allowed to finish or expire first. A stopped application cannot perform cleanup: startup resumes cleanup, and database owners must enforce an offline retention job if deletion is required while MAD is down. This is encrypted **delivery-payload** expiry, not automatic expiry of the password hash in an independently owned login system.

The existing `pending`, `failed`, `sent`, `cancelled` database states are reused. No schema supplement is required. The staff UI retains its layout and shows pending retries versus cancelled/expired delivery. After terminal cancellation, review recipient/configuration first, then use the existing version-checked password reset once to explicitly generate a new credential. Restarting or retrying delivery never resets a password.

There is no exactly-once email guarantee: a timeout or crash after SendGrid accepted a request can cause another email containing the **same** credential. A concurrent reset can supersede an in-flight email; delivery ID/lease guards prevent its completion from overwriting the newer queue entry. Only the latest credential version is valid.

## Configuration and maintenance

Keep `STAFF_CREDENTIALS_KEY` (base64 32-byte AES key), `SENDGRID_API_KEY` and verified `SENDGRID_FROM_EMAIL` private. Set `STAFF_EMAIL_ENABLED=true` to send; false still permits retention cleanup. Keep `DB_LOGGING=false`. Retain the encryption key until outstanding payloads are consumed or cancelled; changing it immediately makes queued payloads unreadable and eventually terminal. Do not inspect/decrypt production payloads for diagnostics.

## Verification register

All execution/evidence fields below are pending; authored tests are not passing-test claims.

| ID             | Requirement / priority | Preconditions and input                                                         | Expected result                                                           | Candidate test                                                                        | Actual / evidence                                |
| -------------- | ---------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| TC-MAD-055-AC1 | AC1 / High             | Disposable PostgreSQL, authorized provision, provider double fails then accepts | Same account/payload retried; `sent`, ciphertext null                     | [staff.e2e-spec.ts](test/staff.e2e-spec.ts)                                           | NOT_RUN; real verified sender/test inbox pending |
| TC-MAD-055-AC2 | AC2 / High             | Due encrypted queue at attempt four; provider rejects                           | Fifth attempt terminal; no sixth send; password/version/account unchanged | [staff.e2e-spec.ts](test/staff.e2e-spec.ts), [staff.spec.ts](src/staff/staff.spec.ts) | NOT_RUN                                          |
| TC-MAD-055-AC3 | AC3 / High             | Payload aged 24 hours; sending disabled                                         | Ciphertext removed, safe expiry code; no send/account mutation            | [staff.e2e-spec.ts](test/staff.e2e-spec.ts), [staff.spec.ts](src/staff/staff.spec.ts) | NOT_RUN                                          |

Existing unit coverage isolates SendGrid success/rejection, cipher authentication, leases, obsolete versions and safe failure logging. Existing API integration cases cover provisioning/reset authorization, invalid input, duplicate emails and rollback. CI must run backend unit coverage and disposable-PostgreSQL integration tests and frontend checks; retain the required >=80% changed-code lines/branches and >=90% critical branches. Do not lower thresholds.

For staging, use approved test recipients for Receptionist, Worker, Kitchen Staff and Kitchen Manager provisioning plus a reset. Record the candidate SHA, safe provider message reference, timestamps, directory status and redacted mailbox evidence showing username/instructions. Verify owner-system first-password change separately. Exercise a controlled provider rejection/timeout, recovery using the same credential, exhaustion and expiry. Inspect safe logs/projections for leakage without publishing credential contents. Record actual results and reviewer approval before closing DDP-055; DDP-054's staff/provider evidence blocker remains open.
