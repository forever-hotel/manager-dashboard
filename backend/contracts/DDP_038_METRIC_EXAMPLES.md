# DDP-038 deterministic metric examples

These are hand-calculated review fixtures, not executed tests or data to insert
into Neon. Local implemented policies are distinguished from proposals awaiting
cross-team approval. Verify against [API contract](../API_CONTRACT.md) and the
linked unit/integration cases before owner sign-off.

## Calendar, bookings and comparisons

Implemented timezone Asia/Colombo (UTC+05:30), Monday weeks, inclusive period start
and exclusive end. At hotel time 2026-10-21 12:00, current week is
`[2026-10-19T00:00:00+05:30,2026-10-26T00:00:00+05:30)`; UTC
`[2026-10-18T18:30:00Z,2026-10-25T18:30:00Z)`. Previous week is Oct12..19.
Current month is Oct1..Nov1, previous Sep1..Oct1: whole calendar periods, not equal
day counts or elapsed month-to-date. A day boundary at local midnight belongs
to the new day; UTC midnight must not be substituted.

Bookings use check_in_date, statuses CONFIRMED/CHECKED_IN/CHECKED_OUT:

| Booking | Check-in | Current status | Oct19..26 count                                                              |
| ------- | -------- | -------------- | ---------------------------------------------------------------------------- |
| A       | Oct19    | CONFIRMED      | 1                                                                            |
| B       | Oct21    | CHECKED_IN     | 1                                                                            |
| C       | Oct22    | CHECKED_OUT    | 1 (policy counts source status/check-in, not inferred real-world chronology) |
| D       | Oct21    | CANCELLED      | 0                                                                            |
| E       | Oct26    | CONFIRMED      | 0 (exclusive end)                                                            |

Total3; daily counts sum3 including zero buckets. C is intentionally a boundary
fixture illustrating the current-status policy, not a recommended operational
record. Booking creation date does not control inclusion.
Tests: [booking unit](../src/analytics/booking-analytics.service.spec.ts),
[real DB](../test/bookings.e2e-spec.ts).

## Revenue, refunds and units

Implemented project policy: COMPLETED payments by paid_at, positive LKR integer
cents, full calendar-period comparison. Current completed payments100000+150000
cents ->250000 (LKR2500.00); previous completed total200000 -> LKR2000.00;
percentage `(250000-200000)*100/200000=25.00%`.
Current PENDING10000, FAILED20000 and REFUNDED50000 contribute0; the refunded
row is excluded, not subtracted as a separately dated cash refund. Previous0
means null percentage and PREVIOUS_REVENUE_ZERO, including current0/previous0.
No exchange-rate conversion or refund date/partial-refund source is implemented.

Changing a historical payment's current status to REFUNDED can change historical
completed-payment reports. This is a current-state metric, not an immutable cash
ledger or net revenue. HW/FDS/payment owner must explicitly adopt this policy or
provide refund amount/date/currency and replacement versioned rules.
Tests: [revenue unit](../src/analytics/revenue-analytics.service.spec.ts),
[DB/revenue integration](../test/bookings.e2e-spec.ts).

## Room-night capacity and low-booking alerts

Rooms101,102 active from Oct1;103 active from Oct22. Room102 under maintenance
`[Oct21,Oct23)`. On Oct21 only101 is eligible (denominator1); booking101 check-in
Oct20/checkoutOct22 occupies101 ->1/1=1. On Oct22,101 and103 are eligible and
the booking has checked out ->0/2=0. Maintenance ends before eligibility is
restored on Oct23. An additional duplicate allocation for101 on Oct21 still
counts one occupied room, not two guests or two bookings.

Capacity counts eligible **rooms/nights**, not room_types.max_guests. Unknown
availability history is an unavailable/source condition, not an invented active
date. A genuinely zero eligible denominator returns null rate. Default threshold
.40 is strictly less-than: 2/5=.40 does not alert;1/5=.20 alerts;0/0=null is in
unavailableDates. Horizon at Oct21 is Oct21..Nov3 inclusive (14dates).
Tests: [occupancy](../test/occupancy.e2e-spec.ts),
[low-booking policy](../src/analytics/low-booking-alerts.service.spec.ts).

## Food, requests and workers

Two included food orders placed in a selected day, at09:00 and09:30 hotel time,
count2 orders and hour09 count2/peakHours[9]. Soup quantities2+3 aggregate5;
five items do not mean five orders. A cancelled third order contributes0. Tied
nonzero peaks all appear; a zero-order day has no peaks and zero buckets.
Tests: [food](../test/food-analytics.e2e-spec.ts).

For a selected day with three submitted requests (ASSIGNED, IN_PROGRESS,
COMPLETED), created total3 and status counts1/1/1 (SUBMITTED0). Two currently
COMPLETED requests completed that day, one submitted earlier, have valid durations
60 and120minutes ->completedCount2, validDurationCount2, average90minutes. An
older currently unresolved request plus the two new unresolved requests gives
backlog3. These are different cohorts, so resolution count need not equal the
created completed count. Invalid negative durations are excluded and flagged;
no valid completions ->null average, not0minutes.
Tests: [requests](../test/service-request-analytics.e2e-spec.ts).

Worker W has those two completed tasks plus three open referenced complaints:
completedTaskCount2, averageCompletionMinutes90, openComplaintCount3, not6 of
either count after joining. Worker V with no tasks/complaints remains0/null/0.
Include inactive historical assignees; current open complaints are SUBMITTED or
UNDER_REVIEW submitted by asOf across all dates, independent of task period.
Test: [worker performance](../test/worker-performance.e2e-spec.ts).

## Task-limit policy — proposal, not implemented

Proposed review bounds **integer1..10 inclusive**, default3. The SRS supplies the
default3, not this range. The range is a conservative configurable review proposal
that permits gradual operational adjustment; WKMS/MAD owners must confirm it.
Do not expose an unrestricted/unlimited value. No settings API/enforcement exists
yet; these examples are required DDP-045 acceptance fixtures, not passing results.

| Input/state                                | Proposed deterministic result                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| Default, no stored override                | Effective3 only after agreed policy bootstrap                                    |
| PATCH1 or10 with current policy version    | Valid bounds; pending until WKMS confirms the same version                       |
| PATCH0,11,2.5,"3",null or unexpected field | 400; keep existing effective policy                                              |
| Non-manager update / missing session       | 403 /401; keep policy                                                            |
| Stale policy version                       | 409; no overwrite                                                                |
| Lower3->2 while worker has3 active tasks   | Keep all3 tasks; block new claim until load<2                                    |
| Limit3, load2, two concurrent claims       | One commits (load3); other denied; count+claim must serialize atomically in WKMS |
| WKMS unavailable/no acknowledgement        | Do not claim new policy effective; preserve/report last acknowledged version     |

Proposed active states ASSIGNED and IN_PROGRESS; UNASSIGNED/COMPLETED excluded.
ESCALATED inclusion is a blocking WKMS decision: until decided, policy enforcement
must not be presented as complete. Version/ack event/API wire names remain open;
do not infer them from the examples. Negative/out-of-bounds examples cannot close
AC3 until real bounds, active-state cohort and atomic claim contract are adopted.
