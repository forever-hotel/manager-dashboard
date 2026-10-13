# Manager dashboard frontend

Next.js uses Tailwind, server-side API forwarding and HttpOnly authentication
cookies. The current UI and login/password-change/logout behavior are retained.

Use Node 22 and configure `.env.local` from `.env.example`. From this directory:

```powershell
node scripts/verify-build-config.mjs
npm ci --ignore-scripts
node scripts/verify-build-config.mjs
npm run dev
```

Use `npm run build` then `npm start` for a production server, or root
`docker compose up -d --build` for the whole application.

Keep the build-config integrity checker and manifest. They detect unexpected
changes to executable configuration before builds. Do not regenerate hashes to
bypass a failure. Review intentional configuration edits and manifest changes
together.

Quality commands: `npm run lint`, `npm run format:check`, `npm run test:cov`,
`npm run test:e2e`, and `npm run test:build-config`. Browser tests need the
disposable backend test database described in `../backend/README.md`.

Detailed local references and investigation evidence are in `../docs/guides/`,
`../docs/reviews/` and `../docs/security/`. These folders are Git-ignored.
