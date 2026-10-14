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
