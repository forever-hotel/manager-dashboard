# Report exports - DDP-030

Protected backend endpoint: `GET /mad/reports/:type?format=csv|pdf`.
A manager session with completed mandatory password change is required.
This ticket implements the export API. Per-view frontend download controls and
its binary BFF belong to DDP-031; existing frontend styling is unchanged.

## Supported reports and filters

| Type | Filters | Existing aggregation reused |
|---|---|---|
| bookings | period=day/week/month | BookingAnalyticsService |
| revenue | period=day/week/month | RevenueAnalyticsService |
| worker-performance (alias staff) | period; optional workerId UUID | WorkerPerformanceService |
| food-orders | period=day/week/month | FoodAnalyticsService |
| service-requests | period=day/week/month | ServiceRequestAnalyticsService |
| occupancy | required from/to YYYY-MM-DD, inclusive, at most 366 days | OccupancyAnalyticsService |
| low-booking-alerts | no additional filters | LowBookingAlertsService, fixed next 14 days |

Format is required. Period defaults to day. Unknown/repeated parameters, unsupported
formats/types, invalid UUIDs/dates, reversed ranges and excessive ranges return 400.
Custom date ranges are not accepted for period-based reports: these services support
current calendar periods only. This avoids inventing a different export policy.

Examples:

```text
/mad/reports/bookings?format=csv&period=week
/mad/reports/revenue?format=pdf&period=month
/mad/reports/worker-performance?format=csv&period=day&workerId=<worker UUID>
/mad/reports/food-orders?format=pdf&period=week
/mad/reports/service-requests?format=csv&period=month
/mad/reports/occupancy?format=pdf&from=2026-10-01&to=2026-10-20
/mad/reports/low-booking-alerts?format=csv
```

Use the same backend Bearer session authorization as other MAD APIs. Do not expose
session JWTs in browser code or put tokens in query strings. The existing gateway
can route these REST paths; no new socket routes or gateway policy is needed.

## Data and file contracts

Exports flatten the authoritative analytics snapshot into Field, Value and Unit
rows. Nested paths such as `trend[0].count`, `workers[0].workerId` and
`resolution.averageMinutes` preserve all buckets, totals, cohorts, identities,
quality flags, freshness and requested filters. This is a summary export, not raw
booking/payment rows or a staff credentials dump. Empty arrays are `[]`, missing
measurements are `null`, and numeric zero remains zero.

Bookings remain counted by check-in date and the existing included statuses.
Revenue remains COMPLETED payments by paid_at, LKR integer cents, excluding other
payment statuses; previous whole calendar period and zero-baseline rules are
unchanged. Worker durations remain minutes; complaints/backlog use existing
current-state cohorts. Food exports preserve the analytics top-10 item limit.
All report policies are inherited from the analytics service, not reimplemented.
A later download can differ from an earlier screen when source data has changed.

CSV is UTF-8 with BOM, CRLF record separators and every field quoted. Commas,
double quotes and embedded newlines remain valid. Leading formula prefixes
`=`, `+`, `-`, `@`, including after whitespace/control prefixes, are neutralized
with a leading apostrophe. This intentionally exports potentially executable
values as text. Negative numbers are also protected text rather than formulas.

PDF uses PDFKit with embedded Noto Sans, Sinhala and Tamil fonts from pinned
Fontsource dependencies. It includes report title, source period boundaries,
Asia/Colombo timezone, units and Page X of Y. Bounds retain explicit ISO offsets;
filenames use the local start date. Scripts outside the included font coverage
are visibly represented as `[U+XXXX]` sequences rather than silently dropped;
CSV preserves their original Unicode text. Font licenses ship in the dependency
packages. No remote font fetch or HTML/browser rendering occurs during exports.
PDFKit references: https://pdfkit.org/docs/text.html and
https://pdfkit.org/docs/getting_started.html.

Headers: `Content-Type: text/csv; charset=utf-8` or `application/pdf`, attachment
Content-Disposition with a server-generated filename, Content-Length,
Cache-Control no-store and X-Content-Type-Options nosniff. Nest StreamableFile sends
the completed bounded buffer; errors occur before attachment headers are committed.

## Resource limits and failures

- Current day/week/month only, or at most 366 occupancy dates.
- At most 200 workers. The export query selects at most 201 to detect excess;
  oversized selections return 422, never a silently truncated report. Filter by
  workerId to narrow the cohort. Normal worker analytics are unchanged.
- At most 10,000 flattened rows, 2,048 UTF-8 bytes per value, depth 12 and 256-character paths.
- At most 8 MiB output and 120 PDF pages.
- At most two in-flight exports per backend instance; excess requests return 503.
- Existing production database statement timeout remains five seconds.
- Oversized exports return 422 REPORT_TOO_LARGE. Retry with narrower filters.
- Missing/invalid sessions return 401; disallowed role/forced-password-change
  sessions return 403. Source failures return sanitized 503, not empty reports.
- Empty sources generate a valid report with zero/empty/unavailable analytics data.

Limits are local to each backend instance. Do not add unbounded export queues or
remove limits to serve raw-data dumps. Profile/report access rules remain in force.

## Deploy and verify

No SQL or new environment variables are needed. Existing analytics views/tables
and grants must already work. Install from the updated backend lockfile and rebuild
backend/Compose. PDFKit and font packages are runtime dependencies; TypeScript
PDFKit definitions are development-only. Installation was performed with scripts
disabled. No hosted database changes were executed.

Unit tests cover routing/filter validation, aggregation reuse, units, CSV safety,
Unicode PDF generation, pagination, limits and concurrent admission. Disposable
PostgreSQL integration tests cover all report types, fixture totals, worker
filters, safe food names, empty reports, headers, invalid inputs, authorization,
source permissions and oversized cohorts. Tests were authored but NOT RUN locally
as instructed. Run the normal backend unit/coverage and integration jobs in CI;
real staging downloads and peer review remain acceptance evidence.

The dependency audit high-severity gate passed. It reports 20 moderate findings
through the existing Jest/sprintf-js development chain; no forced major-version
downgrade was applied as part of this feature.
