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
