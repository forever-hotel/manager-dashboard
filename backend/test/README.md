# Backend verification register

## DDP-009 — booking totals and trends

Execution status: **Not run by the implementation agent**, at the user's request.
All actual results, pass/fail status and evidence links remain pending user execution.
These tests use a test-only Auth provider, not the real central service.

| ID                     | Requirement / priority | File and case                                              | Preconditions and expected result                                                                                                                        |
| ---------------------- | ---------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-DDP-009-AC1-DAY     | AC1 / High             | `bookings.e2e-spec.ts`: half-open day boundaries           | Fixed Colombo-midnight clock; prior/current/next check-in dates, old creation dates; only current date counts with correct UTC boundaries and one bucket |
| TC-DDP-009-AC1-WEEK    | AC1 / High             | `bookings.e2e-spec.ts`: Monday weeks                       | Check-ins around both week boundaries; seven ordered dates, future scheduled dates included and zeroes between counts                                    |
| TC-DDP-009-AC1-MONTH   | AC1 / High             | `bookings.e2e-spec.ts`: month length                       | Leap February, normal February and December rollover; 29/28/31 buckets; next-month date excluded                                                         |
| TC-DDP-009-AC2-EMPTY   | AC2 / High             | `bookings.e2e-spec.ts`: zero-fills empty periods           | Available empty view; 200, zero total, all daily buckets present and null source freshness                                                               |
| TC-DDP-009-AC2-QUERY   | AC2 / High             | `bookings.e2e-spec.ts`: invalid query / omitted period     | Invalid/empty/uppercase/duplicate/unknown parameters return 400 VALIDATION_ERROR; omitted period defaults to day                                         |
| TC-DDP-009-AC3-STATUS  | AC3 / High             | `bookings.e2e-spec.ts`: latest status and replay           | Confirmed, checked-in/out, pending, cancelled and replayed rows; total is 3, source row count remains 8                                                  |
| TC-DDP-009-AC3-MOVE    | AC3 / High             | `bookings.e2e-spec.ts`: rescheduling and tied cancellation | Newer booking moved outside period and same-version cancellation; old rows do not count                                                                  |
| TC-DDP-009-AUTH        | Access / High          | `bookings.e2e-spec.ts`: authentication/role/password gate  | No token or malformed token returns 401; worker and forced-change manager return 403; active manager cases return 200                                    |
| TC-DDP-009-READONLY    | Ownership / High       | `bookings.e2e-spec.ts`: reporting SELECT                   | Restricted role can read view; view writes and direct provider-table reads denied                                                                        |
| TC-DDP-009-UNAVAILABLE | AC2 / High             | `bookings.e2e-spec.ts`: missing view / denied read         | 503 SERVICE_UNAVAILABLE rather than zero metrics; no private SQL details exposed                                                                         |
| TC-DDP-009-UNIT        | Boundaries / High      | `../src/analytics/booking-analytics.service.spec.ts`       | DTO validation, policy metadata, empty/failing query, invalid or overflowing counts and safe totals                                                      |

The integration suite provisions a randomly named disposable database and role,
applies real migrations, creates a provider fixture view and calls the HTTP API.
Its runtime database connection deliberately uses America/New_York to detect
accidental reliance on the database's timezone. Cleanup drops only its own test
database and role. Never point its administrator connection at production.

From `backend`, the user can run:

```powershell
# Focused unit suite (does not need PostgreSQL)
npm run test -- --runInBand src/analytics/booking-analytics.service.spec.ts

# Set TEST_DATABASE_URL to a disposable PostgreSQL database whose name includes
# "test", with an administrator allowed to create/drop temporary databases/roles.
npm run test:integration -- --testPathPatterns=bookings.e2e-spec.ts

# Full unit coverage and integration gates
npm run test:cov -- --runInBand
npm run test:integration
```

Record actual results, environment, date, coverage output and evidence after
execution. New analytics source participates in unit coverage collection, with a
90% branch threshold on the booking service and the existing 80% global thresholds.
