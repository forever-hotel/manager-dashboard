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

## Analytics (DDP-015)

The analytics page fetches `/api/analytics?period=day|week|month` through one client.
The server-side route reads the HttpOnly session cookie and forwards it as a bearer
token to `/mad/analytics/overview` through the existing direct/gateway transport.
Tokens stay out of browser JavaScript. Responses are validated, stripped of unknown
fields and not cached. Backend errors are sanitized. Period changes cancel old
requests and ignore obsolete responses, including transports that ignore aborts.

Booking totals, line/bar charts, revenue and prior-period revenue share the selected
calendar period. An always-visible table provides exact daily booking values.
Native buttons support keyboard access, pressed states identify the selection,
and loading/errors/empty data have status messages. Failed loads can be retried.
Zero previous revenue displays N/A; unavailable API data displays an error, not zero.
Revenue follows the approved completed-payment policy in backend/README.md.

The previous mock occupancy, stay-length, alert and recent-booking content was
removed from this page to avoid presenting invented live metrics. Existing fonts,
neutral colors, cards and chart styling are retained. Export controls remain in
DDP-031; no nonfunctional export buttons are shown.

Run `npm test -- analytics.test.tsx analytics-bff.test.ts` for component/client and
BFF contract cases. Tests were added but not run during implementation.

## Temporary security audit exception (2026-10-15)

CI runs `npm run audit:ci`, which fetches the full npm audit report and rejects
high/critical vulnerabilities. It fails closed if npm or the audit service fails.
The only exception is [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
which currently has no patched braces release. Its five affected packages are one
chain: eslint-config-next -> @next/eslint-plugin-next -> fast-glob -> micromatch -> braces.
The affected recursive glob parser can exhaust the stack on deeply nested input.
Here it is development lint tooling; lint paths are repository-controlled, not
application request input. This exception is risk acceptance, not a vulnerability fix.

The exception applies only when every affected lockfile node in that chain has
`dev: true` and every underlying advisory matches that exact URL. It expires at
2026-11-14 00:00 UTC, after which CI fails until the dependency is fixed or the
exception is reviewed. New advisories and production dependencies remain blocked.
Run `npm audit` to see the unfiltered findings; it still exits nonzero for this advisory.
When upstream fixes it, update the lockfile, remove the exception, and verify CI.
Do not use `npm audit fix --force`: its proposed Next.js lint downgrade is incompatible
with the application's current major version.

Next.js and eslint-config-next are aligned at 16.4.1. Vitest and coverage-v8 are
aligned at 4.1.11, with Vite 7.3.7. Overrides keep optional peer resolution on these
reviewed versions instead of pulling in Vitest 5 and crashing npm's resolver.
Security-policy regression cases are in scripts/audit-ci.test.mjs and run in CI.
