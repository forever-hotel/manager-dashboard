# Manager dashboard frontend

DDP-048: [accessibility changes, checks and manual review](ACCESSIBILITY_GUIDE.md).
Automated tests are authored but unrun locally; WCAG/staging acceptance is pending.

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
Revenue follows the approved completed-payment policy in the backend API reference.

The previous mock occupancy, stay-length, alert and recent-booking content was
removed from this page to avoid presenting invented live metrics. Existing fonts,
neutral colors, cards and chart styling are retained. Export controls are now
implemented under DDP-031; see [the download guide](REPORT_DOWNLOAD_GUIDE.md).

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

## DDP-016 occupancy calendar

Analytics now has an additional monthly occupancy section beneath its existing
content; existing layout, styling, cards and controls are preserved. The calendar
uses the protected GET /api/analytics/occupancy?month=YYYY-MM BFF, which translates
the month to inclusive from/to dates for GET /mad/analytics/occupancy. The session
cookie remains server-side; the existing backend adapter supports direct and gateway
routing. All responses are no-store, validated, and stripped of unknown fields.

Month navigation uses Gregorian leap-year rules and Monday-first weeks. API dates
are used directly without converting them to another timezone. Initial month is
computed server-side for Asia/Colombo. Requests are cancelled on navigation/unmount,
and late responses cannot replace a newer month. Complete months are required;
empty responses display no-data, and incomplete or inconsistent responses fail safely.
Zero bookings with known capacity, zero eligible capacity (unknown rate), loading,
unauthenticated/forbidden access, and retryable failures have distinct states.

Display-only demand bands are Low <40%, Medium 40% to <70%, High >=70%, with
Unknown for no eligible capacity. These bands do not change the separately configured
low-booking alert threshold. Blue/neutral/amber cells include text labels and a visible
legend. Every date is keyboard-focusable and announces date, occupied rooms, eligible
capacity and rate. A visible data table provides the same information without colour.

Tests added: test/occupancy.test.tsx (date boundaries, classifications, accessibility,
loading/empty/unknown/error/retry/race states) and test/occupancy-bff.test.ts (protected
BFF contracts). Existing backend/test/occupancy.e2e-spec.ts provides disposable-database
coverage for the unchanged backend endpoint. Tests were not run locally at the user's
request. Run npm run test:cov and the existing backend integration suite in CI.

## DDP-020 promotion management

The Promotions page now reads real records and room types, with paginated listing,
creation, editing, activation, deactivation and confirmed logical deletion. The
existing page layout, typography and styles are reused; mock text is replaced with
labelled form controls. The inherited Day/Week/Month decoration is disabled because
the promotion API lists all validity periods and defines no period filter.

All MD-05 fields are editable. Fixed discounts use integer LKR cents; percentages
are integers from 1 to 100. Dates are entered in Asia/Colombo (+05:30), with inclusive
start and exclusive end. Select one or more room types (up to 100). Save as draft
creates an INACTIVE promotion atomically; editing preserves its lifecycle status.
Activation and deactivation remain explicit actions. Historical redemption counts
and deleted codes are preserved by the backend.

The browser uses `/api/promotions` and its detail/action/room-types paths. This BFF
validates routes, queries, bodies and response shapes, enforces same-origin JSON
mutations, and forwards the HttpOnly session as a server-side bearer token through
the existing gateway adapter. Nest remains responsible for manager authorization.
Responses are no-store and internal errors/extra response fields are not exposed.

Every existing-record mutation sends its version. A conflict preserves entered
fields and offers Reload latest version. Review changes in the refreshed table
before saving; this explicitly adopts the latest version without silently retrying.
For a duplicate new code, change the code after refreshing. Deleted promotions
cannot be edited again. Failed saves keep input; after a network failure refresh
before retrying because the original write may have committed.

Saved lifecycle and website publication are displayed separately. PENDING means
queued, FAILED means unacknowledged work has a recorded error, and NO_PENDING_WORK
does not prove delivery (including legacy records). None claims website availability.
Refresh reads current publication state. Actual delivery/retry/acknowledgement and
real HW staging verification depend on DDP-040; there is no pretend publish button
or client-triggered redelivery.

No new environment variables or SQL are needed for DDP-020. The DDP-018/019 manual
schema prerequisites must already be applied. Deploy the updated backend before
this frontend so inactive creation and FAILED publication state are supported.
No hosted SQL is executed automatically.

Tests are authored in `test/promotions.test.tsx` and `test/promotions-bff.test.ts`;
real disposable-database cases remain in `backend/test/promotions.e2e-spec.ts`.
Coverage includes the new BFF and component under the existing thresholds. Tests
were not run locally as requested; CI coverage and staging evidence are pending.

## DDP-022 complaint register

The existing Complaints layout and styles now use live DDP-021 data. Search uses
exact category, status and optional worker UUID filters; pagination is server-side
(20 rows). Descriptions, submission times and optional worker references are shown.
Times use Asia/Colombo. An absent worker is labelled explicitly.

View / update opens a labelled, keyboard-focusable detail section with manager-only
history. Closing restores focus; switching/closing with an unsaved note requires
confirmation. Status progresses only SUBMITTED -> UNDER_REVIEW -> RESOLVED. Each
save sends the current version and a trimmed internal note (1–4000 characters).
Repeated saves are locked while pending. Failure preserves editable input and shows
no success message. Conflict requires Reload latest version (keep note), review and
an explicit new save. No automatic retry or silent overwriting occurs.

Successful PATCH confirms persistence, clears the submitted note, and refreshes
detail, register and global status counts. If a subsequent read fails, the confirmed
save message remains alongside a read error; no second write is attempted. Requests
for obsolete filters/details are cancelled and their late results are ignored.
Draft notes remain in component memory only, not URLs, storage or analytics events.

The protected `/api/complaints` BFF forwards GET list/detail and PATCH by UUID through
the existing gateway adapter. It validates routes, filters, payloads and response
shapes, forwards the HttpOnly session only server-side, rejects cross-origin JSON
mutations and strips provider internals. Every response is no-store. Backend guards
remain authoritative for manager/first-login permissions. Guest access is not added.

Global open count is SUBMITTED + UNDER_REVIEW; review count is UNDER_REVIEW. Existing
room/severity cells and monthly/average-resolution cards display unavailable values
because DDP-021 does not provide those fields/metrics. The inherited Day/Week/Month
controls stay visible but disabled; no date-filter contract exists. No fabricated
records or analytics remain. Count requests are separate live snapshots, not a
transactional analytics report.

DDP-043 integration hook: listen on window for `mad:complaint-status-changed` after
a confirmed update, with detail `{ id, status, version }`, and refetch unresolved
counts. No note or guest content is included. This is a local invalidation event,
not cross-service notification delivery; the notification feature remains DDP-043.

No new SQL or environment variables. Apply DDP-021's manual schema/role grants before
deployment if not already done. Tests are in `test/complaints.test.tsx` and
`test/complaints-bff.test.ts`, with existing backend disposable-DB tests for DDP-021.
Coverage collection includes the complaint BFF. Tests were authored but not run
locally; CI coverage and staging acceptance remain pending.

## Kitchen overview (DDP-026)

## Low-demand promotion suggestions

Analytics loads the next 14 hotel-local dates through the authenticated, no-store
low-booking BFF. It shows below-threshold occupancy, unknown-capacity dates and
distinct loading/error/retry states, plus direct PDF/CSV forecast downloads. Create
Promotion opens the existing form with editable Colombo midnight-to-next-midnight
dates. Invalid/repeated date query values are ignored; navigation never saves or
activates a promotion. Existing validation and explicit save actions still apply.
