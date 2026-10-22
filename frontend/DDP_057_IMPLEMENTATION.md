# DDP-057: low-demand promotion suggestions

Analytics now includes a Low-demand dates section using the existing DDP-011 API. Existing chart, calendar, promotion form and styling remain intact. The section loads independently: failure of revenue analytics does not hide low-demand errors or available alerts.

## Behavior and contract

- `GET /api/analytics/low-booking-alerts` forwards the HttpOnly session server-side to `GET /mad/analytics/low-booking-alerts`. It accepts no query parameters, returns no-store responses, preserves 401/403 and sanitizes upstream failures to 503. Payload validation rejects malformed ranges, duplicate/out-of-range dates and inconsistent occupancy data.
- The existing backend owns the 14-day range (hotel today through day 13 inclusive), configurable `LOW_BOOKING_THRESHOLD`, eligible-room denominator and booking statuses. Alerts use a strictly lower occupancy rate than the configured threshold; this UI does not invent another threshold. Unknown occupancy dates are disclosed separately.
- Each alert shows the hotel date, expected occupancy percentage and occupied/eligible room counts, plus an accessible Create Promotion link. Reporting range, timezone, threshold and timestamp are visible.
- The link opens `/promotions?lowDemandDate=YYYY-MM-DD`. The server validates the single query value before it is used to initialize the existing create form. Invalid or repeated values do not prefill dates. It only prefills valid-from at that date's Colombo midnight and valid-until at the following midnight (exclusive), including month/year/leap-day rollovers. These are editable hotel-local inputs; the existing form converts them to explicit `+05:30` timestamps on submission.
- No code, discount, room types or redemption limit is invented. No mutation or activation happens on navigation or initial render. The manager must complete the existing validated form and explicitly select Save as draft or Save & activate. The usual DDP-020 validation and concurrency protections still apply. A stale/past suggestion can fail the existing validation; it never bypasses it.
- Loading, no-alert, unavailable-occupancy, session/permission failure and retry states are distinct. A failed request never displays a healthy-demand/no-alert result. Requests abort on unmount and stale completions are ignored.

No schema or hosted SQL changes are required. No new Nest endpoint or gateway route is needed: the existing routing-only gateway already forwards the MAD analytics prefix. No central login or browser exposure of session tokens is introduced.

## Verification register

All tests are authored but **NOT_RUN locally**. CI coverage, browser/staging verification and peer approval remain pending.

| ID             | Requirement / type / priority | Preconditions and input                                                                       | Expected result                                                                       | Candidate files                                                                                        | Actual / evidence |
| -------------- | ----------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------- |
| TC-MAD-057-AC1 | AC1 / component + BFF / High  | Valid 14-day response with a below-threshold date                                             | Date, occupancy, threshold and date-specific action visible; safe no-store forwarding | [low-demand.test.tsx](test/low-demand.test.tsx), [low-demand-bff.test.ts](test/low-demand-bff.test.ts) | NOT_RUN           |
| TC-MAD-057-AC2 | AC2 / component / High        | Alert link and leap-day/year-boundary date                                                    | Existing form prefilled with half-open Colombo dates; no mutation until explicit save | [promotions.test.tsx](test/promotions.test.tsx), [low-demand.test.tsx](test/low-demand.test.tsx)       | NOT_RUN           |
| TC-MAD-057-AC3 | AC3 / component + BFF / High  | Empty alerts, unknown denominator, provider failure, malformed data, retry and denied session | Clear empty/unknown/error states, recovery and no misleading healthy-demand state     | [low-demand.test.tsx](test/low-demand.test.tsx), [low-demand-bff.test.ts](test/low-demand-bff.test.ts) | NOT_RUN           |

Existing [occupancy.e2e-spec.ts](../backend/test/occupancy.e2e-spec.ts) uses real disposable PostgreSQL for the low-booking source, threshold/boundary and protected API contract. Existing promotion tests exercise explicit creation and validation. Analytics overview tests isolate the new independently tested section to preserve their own deterministic request fixtures.

CI must run frontend unit/component/BFF coverage, backend integration coverage, lint/build and browser acceptance. Keep the required >=80% changed-code line/branch and >=90% critical branch coverage gates. For staging, record candidate SHA, a known below-threshold fixture, alert screenshot, navigation and editable prefill, absence of mutation before save, actual explicit draft submission, empty/error/retry behavior and reviewer evidence. Do not create live promotions without an approved test fixture.

This addresses the MD-04 implementation gap recorded in DDP-054; it does not retroactively mark that audit's acceptance tests, provider evidence or release gate as passed.
