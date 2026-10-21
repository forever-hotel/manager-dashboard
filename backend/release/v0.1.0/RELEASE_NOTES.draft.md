# v0.1.0 candidate notes - UNRELEASED

Candidate/baseline SHA, release date, CI/staging evidence and approver: pending.
This is preparation for DDP-017, not a published release or acceptance claim.

Candidate scope: Next.js/NestJS foundations, containers and CI, manager-owned login
and first-password-change/logout/session enforcement, protected responsive shell,
booking/revenue analytics, occupancy calendar/low-booking API, staff provisioning,
email queue, reset and profile/activation management.

Approved implementation differences from the original tickets: each subsystem
owns its login; the gateway routes REST only; Neon schema changes are reviewed
and applied manually with synchronization disabled. Booking counts use check-in
dates. Revenue is completed-payment revenue, not a refund-event ledger.

Pending: final-commit CI/coverage, actual provider staging, owner agreements and
current security-release disposition. Review the [readiness gate](../../SPRINT_5_READINESS.md).
No test result or external owner sign-off is assumed from source presence.

After acceptance, replace candidate claims with verified outcomes and attach
register/defect links, exact deployment and manual SQL revisions, rollback owner,
review approval and release date. Rollback must preserve shared data and coordinate
schema compatibility; do not automatically undo Neon DDL or delete records.
