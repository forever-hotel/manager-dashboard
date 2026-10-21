# v0.2.0 candidate notes — UNRELEASED

This is a draft, not a released version or acceptance claim. Do not tag or publish
it until DDP-036 is accepted. Candidate SHA, release date and approver: pending.

## Candidate scope requiring verification

- Versioned promotion creation/lifecycle and manager UI, including publication
  visibility. Actual Hotel Website publication remains blocked by DDP-040.
- Complaint register, authorized status transitions and manager internal history.
- Staff directory/profile/role/reset/deactivation workflows for all four roles.
- Service/worker/food analytics views and their zero/error/period states.
- Read-only operational APIs and underlying room/task/kitchen/stock event handling
  delivered in Sprint 6; this does not accept later Sprint 7 frontend live boards.
- Worker task-limit settings/enforcement and low-demand promotion suggestions:
  not implemented yet (DDP-045/DDP-057), still required before acceptance.

## Current limitations

No current CI/coverage/staging acceptance results are attached. DDP-017 acceptance
is unverified. Real provider publication, role-specific login/session behavior
and event contracts require their owning teams' evidence. Export functionality
and later Sprint 7 scope are excluded from this acceptance claim.

## Finalize only after approval

Replace candidate language with verified outcomes, link all accepted register
rows and defects, record supported provider versions/manual SQL prerequisites,
deployment and rollback owner, candidate/baseline SHAs, staging evidence, review
approval and final release date. Never automatically undo shared Neon schema or
delete production data as a rollback; coordinate database compatibility manually.
