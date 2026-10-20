# Report downloads - DDP-031 and approved DDP-032/033 prerequisites

The Reports index and analytical views share ReportDownload. CSV/PDF requests use
an HttpOnly session through Next.js; no JWT appears in a download URL or browser
Authorization header. Download responses are validated before an object URL is
created. Progress disables both format buttons, failures expose an accessible
retry control, and object URLs are revoked after use and during cleanup.

## Available controls

- Analytics: separate booking and revenue downloads use the selected day/week/month.
- Occupancy calendar: downloads use the loaded month range, inclusive from/to dates.
- Food orders and service requests: downloads use the selected reporting period.
- Worker performance: downloads use the reporting period and applied worker ID.
- Reports index: all DDP-030 report types, period/worker or occupancy range filters,
  plus low-booking alerts (fixed next 14 days). Staff is the worker-performance alias.

Worker sorting and pagination are presentation controls; exports include the full
matching analytical cohort, as labelled beside the buttons. Sorting is stable by
worker ID for ties, N/A durations remain last in both directions, and page resets
on period/filter/sort changes. Complaint links open the selected worker's Submitted
or Under review filter. No task claim/assignment controls are introduced.

## Real analytical panels

DDP-032 and DDP-033 were approved as prerequisites. Food/service/worker mocks are
replaced with real snapshots from the existing DDP-023/024/025 APIs. Period changes
abort obsolete requests; late responses cannot overwrite the current selection.
Tables provide labelled equivalent data with zero/N/A handling, hotel-local period
boundaries, duration units, backlog/completion cohort notes and freshness/quality
information. Existing typography, colors, cards and panel layout are reused.
The existing live kitchen queue remains independent of analytics request failures.

Food totals use eligible placements, popular items retain the top-10 limit, and
hours are placement hours in Asia/Colombo. Service counts use submitted dates;
completion averages use valid durations among completions in the selected period.
Current unresolved backlog includes all dates. Worker complaint counts use the
existing all-date open-complaint cohort, including historical/inactive assignees.
Unsupported mock metrics are replaced with supported real metrics.

## Transport and validation

`GET /api/reports/:type` validates the same filter names and limits as DDP-030,
then calls `/mad/reports/:type` through BACKEND_API_URL. It uses a 30-second timeout,
no redirects, bounded response reading (8 MiB), validated content type and attachment
filename, PDF signature/end marker or UTF-8 CSV header/record validation. Errors
remain JSON with sanitized 400/401/403/404/422/503 responses. Corrupt/truncated/error
bodies never become successful download attachments. Cross-site requests are denied.

`GET /api/analytics/operations/:type` supports food-orders, service-requests and
worker-performance, validates filters and response schemas, and returns no-store
results. Missing/invalid sessions and disallowed permissions remain 401/403.
The existing booking/revenue and occupancy proxies are reused.

No SQL, new environment variables or dependency installation is required. DDP-030
must already be deployed and its analytics sources/grants operational. Existing
BACKEND_API_URL / BACKEND_API_MODE configuration supports direct or gateway routing.
Rebuild the frontend to include the new routes. A download rereads the authoritative
source and can differ from an earlier screen when source records have changed.

## Verification

Tests authored, NOT RUN locally as instructed:

- reports.test.tsx: current filters, filenames, progress, duplicate prevention,
  retry, corrupt data, URL cleanup, Reports index and size limits.
- reports-bff.test.ts / operations-bff.test.ts: protected route validation,
  server-only credentials, binary headers, safe errors and invalid source data.
- operations.test.tsx: food/service zero/N/A, tables, stale responses/retry,
  worker sorting/filtering/paging and complaint links.
- test/browser/reports.spec.ts: real disposable PostgreSQL -> Nest analytics and
  report service -> Next BFF -> browser download, empty reports and view filters.

The browser test stack creates reporting fixture tables only in its isolated
mad_browser_test_* database using backend/test/report-browser-fixture.sql. Never
run that fixture against Neon. No SQL is executed by application startup.
Run existing CI unit/coverage/browser jobs; coverage and staging acceptance are
pending evidence. Existing DDP-030 backend integration tests continue to cover
provider/permission failures and analytical export policies.
