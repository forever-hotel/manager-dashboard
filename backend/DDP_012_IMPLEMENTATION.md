# DDP-012: staff account provisioning

Implements MD-14, MD-15 and MD-15b (SRS 6.4; SDS 4.4, 5.2.2, 6.1.3 and 6.1.4).
Scope: manager-authorized account creation and durable credential email delivery.
The staff management frontend, resets and other subsystems' login implementations
remain separate work. Existing manager login and bootstrap behavior are preserved.

## API contract

`POST /mad/staff` requires a current MAD manager bearer token whose password has
already been changed. The local gateway also exposes `/mad/staff` unchanged (see
`deploy/gateway.routes.local.json`).

```json
{
  "name": "Example Staff",
  "vocation": "Reception",
  "email": "staff@example.com",
  "age": 25,
  "phone": "+94771234567",
  "nic": "200012345678",
  "role": "RECEPTIONIST"
}
```

Roles: `RECEPTIONIST`, `WORKER`, `KITCHEN_STAFF`, `KITCHEN_MANAGER`.
All fields are required. Names/vocations are trimmed, limited to 255/100 characters,
and cannot contain control characters or angle brackets. Email is trimmed and
lowercased. Age must be an integer from 1 to 120. Phone uses 7-15 digits with an
optional leading `+`. NIC uses Sri Lankan formats: 12 digits or 9 digits followed
by V/X (normalized to uppercase). These are API validation policies, not claims
that the SRS specifies an employment-age policy. Unknown fields are rejected.

201 response contains only `staffId`, `deliveryId`, `deliveryStatus: "pending"`.
No temporary password, username or hash is returned to the manager UI.
Errors use `{code,message,details?}`: missing/invalid session 401; disallowed role
403; unchanged manager password 403 `PASSWORD_CHANGE_REQUIRED`; invalid input
400; duplicate email 409; unavailable configuration/storage 503.

## Setup (manual database changes only)

1. Apply the shared hotel schema and `deploy/neon-mad-auth.sql` as already
   documented. Review and manually apply `deploy/neon-mad-staff.sql` in Neon.
   This creates the encrypted delivery queue and a case-insensitive unique email
   index. Existing duplicate emails must be resolved by the database owner first;
   the script does not delete or merge accounts.
2. For a separate runtime role, grant `SELECT, INSERT` on `staff_users` and
   `SELECT, INSERT, UPDATE` on `mad_staff_deliveries`, in addition to its existing
   login grants. Substitute your actual runtime role, not PUBLIC. Do not grant
   schema ownership or schema-changing permissions to the application.
3. Generate a dedicated encryption key locally:

   ```powershell
   node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

   Save it privately as `STAFF_CREDENTIALS_KEY` in root `.env` for Compose or
   `backend/.env` for direct backend development. Never reuse the JWT secret.
   Keep it stable across restarts and replicas; retain it with protected backups.
4. Configure a SendGrid API key with Mail Send permission in `SENDGRID_API_KEY`
   and a verified sender address in `SENDGRID_FROM_EMAIL`. Set
   `STAFF_EMAIL_ENABLED=true` when ready to send actual emails. While false,
   accounts can still be created and queued if the encryption key is configured.
   Without the encryption key, creation returns 503 before any write. No private
   values are supplied in committed examples.
5. Keep `DB_LOGGING=false`. Startup rejects query logging to avoid recording
   profile and credential parameters. Rebuild/recreate the backend after changing
   Compose environment: `docker compose up -d --build mad-backend`.

Compose passes these variables through. It does **not** execute SQL or synchronize
the Neon schema. The additional SQL mount in `deploy/compose.ci.yml` is exclusively
for a disposable CI database.

## Delivery and operations

Creation atomically saves an active account with `password_change_required=true`
and an encrypted outbox record. Passwords use 24 cryptographically random bytes,
encoded as 32 base64url characters, then bcrypt cost 12. Usernames use random UUIDs
and database uniqueness constraints. Emails are case-insensitively unique.
AES-256-GCM protects the temporary credentials; the delivery ID authenticates the
payload association. The plaintext exists only in memory and the outgoing email.

Every 15 seconds, each enabled worker claims one due message with PostgreSQL
`SKIP LOCKED` and a 60-second lease. Failed delivery retains the encrypted payload
and retries after 30 seconds, doubling to a maximum of one hour. Restarting never
creates a second account or generates another temporary password. An expired
lease can be recovered by another instance. Obsolete credentials are cancelled
when the account is inactive, its password-change flag is cleared or its session
version changes. Sent/cancelled records have their ciphertext removed.

`sent` means SendGrid accepted the request with HTTP 202, not confirmed inbox
delivery. See the [SendGrid Mail Send contract](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send).
There is an eight-second request timeout. Delivery is at least once: a crash after
provider acceptance but before saving `sent` can cause duplicate emails containing
the same credentials. It cannot create duplicate accounts. Bounce/event-webhook
tracking and password resets are outside this ticket.

Inspect status without selecting credential payloads:

```sql
SELECT delivery_id, worker_id, status, attempts, next_attempt_at,
       last_error_code, created_at, sent_at
FROM public.mad_staff_deliveries
ORDER BY created_at DESC;
```

Investigate persistent `failed` rows by checking sender verification, provider
availability and key configuration. Correct configuration and let scheduled retries
run; do not recreate accounts. The stored error code is deliberately generic and
provider bodies are not logged. Do not rotate the encryption key while pending or
failed deliveries exist without a separate reviewed re-encryption procedure.
Historical queue records may be retained under the hotel's retention policy.

## Other subsystem contract

There is no central login service. Each staff subsystem must verify the bcrypt
hash, check `is_active`, and restrict first-login sessions until it has saved a new
password and cleared `password_change_required`. Password changes/resets must
increment `session_version`. Confirm this contract with the subsystem owners
before real staff onboarding. This repository cannot enforce another system's
login behavior. MAD manager authentication continues using its existing password
implementation; staff provisioning does not grant manager access.

## Verification register

All tests below are **added, not executed**. No Neon SQL or real SendGrid messages
were executed for this task. Coverage and staging acceptance remain unverified.
TypeScript compilation (`tsc --noEmit --incremental false`) passed, including test
sources. Changed TypeScript files were formatted with the repository's Prettier.
Scoped ESLint checks passed for the changed TypeScript files. These static checks
do not establish runtime behavior or test coverage.
Unit file: [staff.spec.ts](src/staff/staff.spec.ts).
Integration file: [staff.e2e-spec.ts](test/staff.e2e-spec.ts).

| ID / requirement | Type / priority | Preconditions and input | Expected result | Actual / status / evidence |
| --- | --- | --- | --- | --- |
| TC-MAD-012-AC1 / account creation | API + DB / high | Disposable PostgreSQL, manager token, each valid role | 201, correct profile, bcrypt >=12, forced-change flag, encrypted pending message | Not run; integration file |
| TC-MAD-012-AC2 / validation | API + DB / high | Duplicate email, invalid/missing field, unsupported role, unknown field | 409/400, no partial account | Not run; integration and unit files |
| TC-MAD-012-AC3 / concurrency and retry | API + DB / high | Concurrent creates, provider rejection then acceptance | Unique accounts/usernames, same credentials retried, failed then sent, ciphertext cleared | Not run; integration file |
| TC-DDP-012-AUTH / access control | API + DB / critical | No/invalid token, worker token, first-login manager | 401/403 and no writes | Not run; integration file |
| TC-DDP-012-ATOMIC / rollback | API + DB / critical | Revoke queue INSERT from runtime role | 503 and account insert rolled back | Not run; integration file |
| TC-DDP-012-CRYPTO / credential protection | Unit / critical | Roundtrip, tampering, wrong delivery ID, missing key | Authenticated encryption, protected failures, cost-12 hash | Not run; unit file |
| TC-DDP-012-PROVIDER / delivery policy | Unit / high | Mock 202, 400, 401, 429, 500; stale account | Only 202 accepted, failure retry, obsolete credentials discarded | Not run; unit file |

Run from `backend` with Node 22 dependencies installed:

```powershell
npm ci
npm test -- --runInBand staff.spec.ts
# Set TEST_DATABASE_URL to a DISPOSABLE PostgreSQL database whose name contains test.
# Its administrator must be able to create/drop isolated databases and roles.
# Never use Neon application credentials here.
npm run test:integration -- staff.e2e-spec.ts
npm run test:cov -- --runInBand
```

Integration tests load SQL from the repository's `deploy/` directory, so keep the
whole repository available when running them in a container. Email is mocked.
CI thresholds include staff code: >=80% global lines/branches and >=90% branches
for creation and delivery logic. Passing coverage, full CI, owner agreement,
verified staging email, review and issue/PR evidence remain release requirements.

## Suggested commit

```text
feat(staff): create accounts with retryable SendGrid delivery

Add manager-authorized provisioning for all four staff roles, bcrypt
credentials, encrypted delivery retries and manual Neon setup.
Include unit and database integration coverage for DDP-012.

Refs: DDP-012
Closes #<actual-GitHub-issue-number>
```

Replace the issue placeholder with the real linked issue before committing.
