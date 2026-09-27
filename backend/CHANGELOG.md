# Backend changelog

## Unreleased

- DDP-010: add `GET /mad/analytics/occupancy` with inclusive date ranges of up to
  366 days, distinct eligible room-night counts, checkout exclusion, daily
  maintenance/active-room capacity and null rates when capacity is zero.
- Add read-only grants for the three provider-owned occupancy reporting views,
  strict date validation and safe source-unavailable errors.
- Add unit and disposable PostgreSQL integration cases. Tests have not been run
  at the user's request; occupancy policy and real provider contracts remain
  subject to DDP-038 confirmation.
