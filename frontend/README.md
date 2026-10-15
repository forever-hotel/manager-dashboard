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
