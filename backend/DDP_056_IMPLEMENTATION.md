# DDP-056: comparable revenue summaries

Implementation reviewed against MD-03. CI, measured coverage, peer review and real-source staging evidence remain pending. No tests or hosted SQL operations were run locally.

## Approved recognition policy

The user approved this policy during DDP-015: sum `public.payments.amount` for `payment_status='COMPLETED'`, recognized by `paid_at`. Amounts are integer **LKR cents**; no currency conversion is performed. The owner must guarantee this currency/unit contract for every row. `REFUNDED`, `PENDING` and `FAILED` rows are excluded in both periods. This is labelled `completed_payment_revenue`, not net revenue or a refund-event ledger. If a payment later becomes REFUNDED, historical totals change; there is no refund amount/date source for recognition on a separate refund date.

`GET /mad/analytics/revenue?period=day|week|month` defaults to day. The manager-only session guard enforces 401 for absent/invalid sessions and 403 for other roles or a manager still required to change their password. Invalid periods/extra query parameters return 400 through existing DTO validation.

Calendar boundaries use Asia/Colombo, Monday-start weeks, and whole calendar periods. Start is inclusive and end exclusive. The previous period is the preceding full day/week/month, including its actual calendar length. These are not elapsed-to-date comparisons. `asOf` determines the calendar period; it does not truncate the aggregation at the reporting instant. Valid dated payments later within the same period are included under the approved whole-period rule.

## Exactness and failure behavior

The SQL aggregates directly from payment rows without booking joins, so multiple distinct payments for one booking each count once. PostgreSQL numeric arithmetic computes totals and rounds percentage change to two decimal places before JSON conversion. `currentMinor` and `previousMinor` must fit JavaScript's safe nonnegative integer range; malformed, fractional or unsafe aggregate results return a sanitized 503.

Percentage is `(current-previous)*100/previous`. A zero previous total returns `percentageChange=null` and `percentageUnavailableReason='PREVIOUS_REVENUE_ZERO'`. Empty readable data returns genuine zero totals. Missing/denied source access, incomplete completed-payment data and malformed aggregate output return 503 instead of fabricated zeroes. Completed rows with missing `paid_at` fail closed because they cannot be assigned to a period. In-scope nonpositive/missing amounts also fail closed.

DDP-056 strengthens aggregate validation to reject empty strings, malformed invalid-row counts, duplicate aggregate rows and inconsistent null comparisons. Existing overview, frontend and export consumers retain their response contract and layout. No database migration or manual SQL is required for this change. The application continues to read the existing payments source without changing it.

## Test register

| ID              | Requirement / type / priority    | Preconditions and input                                                                | Expected result                                                                  | Candidate file                                                                       | Actual / evidence         |
| --------------- | -------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------- |
| TC-MAD-056-AC1  | AC1 / API + disposable DB / High | Fixed clock, completed and refunded/pending/failed payments, repeated booking IDs      | Exact cents, one count per payment, positive/negative rounded comparisons        | [bookings.e2e-spec.ts](test/bookings.e2e-spec.ts)                                    | NOT_RUN; evidence pending |
| TC-MAD-056-AC2  | AC2 / API + disposable DB / High | Empty readable table; current-only rows; denied source; completed payment missing date | Zero/null with reason for readable zero totals; 503 for unavailable/invalid data | [bookings.e2e-spec.ts](test/bookings.e2e-spec.ts)                                    | NOT_RUN; evidence pending |
| TC-MAD-056-AC3  | AC3 / API + disposable DB / High | Colombo midnight, Monday/year change, leap month; invalid query and denied sessions    | Half-open boundaries, exact precision, 400/401/403 and no writes                 | [bookings.e2e-spec.ts](test/bookings.e2e-spec.ts)                                    | NOT_RUN; evidence pending |
| TC-MAD-056-UNIT | AC1/AC2/AC3 / Unit / High        | Mock aggregate rows, clock and database failures                                       | Valid negative/zero cases preserved; malformed/unsafe aggregates fail closed     | [revenue-analytics.service.spec.ts](src/analytics/revenue-analytics.service.spec.ts) | NOT_RUN; evidence pending |

CI must run backend unit coverage and real disposable-PostgreSQL integration tests, preserving >=80% changed-code line/branch coverage and >=90% critical branch coverage. Existing analytics UI and report regression suites cover consumers. Tests are authored evidence candidates, not reported passing results.

For staging, the HW/FDS payment owner must confirm LKR-cent units, supply approved completed/refunded/boundary fixtures, and independently reconcile each total. Record candidate SHA, redacted fixture references, request/expected/actual response, CI/coverage links and reviewer approval. Never alter live financial rows for a smoke test. Separate refund accounting or elapsed-period comparisons require a new approved policy and source contract.
