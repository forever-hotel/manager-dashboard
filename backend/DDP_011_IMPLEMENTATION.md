# DDP-011: low-booking date alerts

## API contract

`GET /mad/analytics/low-booking-alerts` requires an active MANAGER session with the
initial password change completed. It accepts no query parameters. Client attempts
to override the threshold or date range return 400 VALIDATION_ERROR.

One request evaluates exactly 14 Asia/Colombo calendar dates, including today,
through one call to the existing occupancy calendar service. The clock is shared
with booking analytics and injectable for deterministic tests. Month/year/leap-day
boundaries are handled as calendar dates, independently of the server timezone.

The response has `from`, `to`, `timezone`, `rangeEndInclusive`, `threshold`,
`includedStatuses`, `denominator`, `freshness`, `alerts` and `unavailableDates`.

Each alert contains `date`, `occupiedRooms`, `eligibleRooms`, `rate` and
`promotionSuggestion`. Only known rates strictly less than the threshold qualify;
equality does not generate an alert. Suggestions are informational text, not
automatically created promotions or a recommended discount percentage.

Zero-capacity dates have `rate: null` and are returned separately in
`unavailableDates`, with reason `ZERO_ELIGIBLE_ROOMS`. They never receive promotion
suggestions. Empty results return HTTP 200 with `alerts: []`.

Missing/invalid sessions return 401; non-manager or forced-change sessions return
403. Missing reporting data, incomplete room availability or database permission
failures return the existing generic 503 envelope. No error details or credentials
are exposed. The endpoint performs no writes.

## Configuration and deployment

`LOW_BOOKING_THRESHOLD=0.40` uses the ticket's proposed default, not a confirmed
SRS business rule. Business-owner confirmation remains pending. Supported values
are decimal fractions from 0 through 1. An omitted setting uses 0.40; an explicitly
blank, malformed, non-finite or out-of-range value fails startup. Environment
examples and Compose pass the setting to the backend; it is not a frontend setting.

This reuses the DDP-010 reporting views and manual Neon provisioning. There are no
new tables, migrations, automatic schema changes, notifications or frontend work.
Existing booking statuses, maintenance exclusions and checkout-exclusive room
nights retain their DDP-010 meaning. Rebuild/recreate the backend to deploy.

## Test register and verification

All tests below are implemented but **not run**: the Docker verification request
was declined. No build, coverage or live-provider result is claimed.

| ID | Requirement / expected result | Type / priority | File | Actual / status |
| --- | --- | --- | --- | --- |
| TC-DDP-011-AC1 | Five eligible rooms, one occupied: 0.20 produces an alert and suggestion | API/DB / High | test/occupancy.e2e-spec.ts | Not run |
| TC-DDP-011-AC2 | Two of five occupied: equality at 0.40 produces no alert | API/DB / High | test/occupancy.e2e-spec.ts | Not run |
| TC-DDP-011-ZERO | No eligible rooms: all 14 dates explicitly unavailable, no alerts | API/DB / High | test/occupancy.e2e-spec.ts | Not run |
| TC-DDP-011-AC3 | Fully occupied range returns 200 and an empty alert list | API/DB / High | test/occupancy.e2e-spec.ts | Not run |
| TC-DDP-011-CONFIG | Invalid thresholds rejected, boundaries 0/1 accepted | Unit / High | src/analytics/low-booking-alerts.service.spec.ts; src/config/environment.spec.ts | Not run |
| TC-DDP-011-DATES | Colombo midnight, leap day, year boundary; one inclusive 14-date request | Unit / High | src/analytics/low-booking-alerts.service.spec.ts | Not run |
| TC-DDP-011-AUTH | Missing/invalid sessions 401; worker and forced-change sessions 403; query overrides 400; no reporting writes | API/DB / High | test/occupancy.e2e-spec.ts | Not run |
| TC-DDP-011-FAILURE | Removed reporting SELECT privilege yields sanitized 503 | API/DB / High | test/occupancy.e2e-spec.ts | Not run |

API/DB tests provision their own disposable database and roles using
TEST_DATABASE_URL; never point this at Neon. Existing occupancy fixtures and
seeded manager/worker accounts are prerequisites created by the test setup.

```powershell
# From backend; install dependencies first if needed.
npm run build
npm test -- --runInBand low-booking-alerts.service.spec.ts environment.spec.ts
npm run test:integration -- --runTestsByPath test/occupancy.e2e-spec.ts
npm run lint
npm run format:check
npm run test:cov
```

Review, CI/coverage, staging verification and the business threshold decision are
still required before marking the planning ticket Done. This document records
implementation, not those external approvals.
