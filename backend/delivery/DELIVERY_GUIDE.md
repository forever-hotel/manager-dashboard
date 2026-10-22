# Demonstration and handover - DDP-053

Prepared 2026-10-22 against source baseline
`27b3c315b32f92d19010d5d019d5804bb17db204` (the preceding commit, not a release).
**Delivery gate: NOT_ACCEPTED. Demo/rehearsal: NOT_RUN. v1.0.0: NOT_PUBLISHED.**
This documentation package does not create a tag/release, run tests or seed/reset
any database. There are no executable/UI/schema changes; coverage for this docs
change is N/A. Actual application CI/coverage and review evidence are still needed.

## Package

- [Demo script](DEMO_SCRIPT.md) and [requirement register](demo-register.csv).
- [Synthetic fixtures and reset/fallback procedure](FIXTURES_AND_FALLBACK.md).
- [Manager/staff handover walkthrough](USER_HANDOVER.md).
- [Submission artifact index](artifacts.csv), including missing external artifacts.
- [Final report draft](FINAL_REPORT.draft.md) and
  [v1.0.0 release-note draft](RELEASE_NOTES_v1.0.0.draft.md).
- [Review, retrospective and contribution/evaluation records](ASSESSMENT_RECORDS.md).
- [Delivery acceptance register](acceptance-register.csv).

## Entry and delivery gate

Confirm accepted DDP-037 documentation review, DDP-051 real release rehearsal and
DDP-052 actual manager/supervisor UAT before final delivery. These gates are not
closed by prepared code, static checks or this guide. DDP-052 reviewers/staging
were explicitly not ready at the last update. Required security, performance,
accessibility, operations and completeness evidence remains linked through their
respective registers; do not invent passing results here.

The56-case demo register maps all22 MD identifiers plus task policy, access/security,
accessibility and recovery. Each must be exercised with realistic owner-seeded
data on the accepted candidate and have actual presenter/date/result/evidence.
Visible low-demand suggestion/date-prefill remains a known DDP-057 gap. Real HW
redemption, owner staff login/revocation and WKMS atomic claims need actual provider
adoption/evidence. A fallback recording or contract fixture does not close a live
requirement that cannot be demonstrated.

Before submission, the coordinator resolves all31 artifact entries' owners,
immutable version/checksum, location, access-tested reviewer/date and actual
approval. SRS/SDS/course documents under ignored docs/ are not shipped in a clean
clone; obtain approved external versions and access links instead of editing or
assuming those private documents are published. ADR-038-001 exists but owner/
supervisor acceptance remains pending. A final report/release-note draft is not
the final submitted report or a published v1.0.0 release.

## Handover session

1. Agree panel/demo duration, manager/operator audience, candidate/environment,
   source owners, synthetic fixture IDs and emergency contact availability.
2. Rehearse the complete script and all role/export variants; record real outcomes
   and defects. Keep a sanitized fallback recording of that exact candidate.
3. Have the manager perform the user walkthrough, then have infrastructure staff
   locate private configuration, monitoring, logs, backups and recovery evidence
   through their authorized access. Do not display or transfer secrets on screen.
4. Independently test every submission link with panel/hotel reviewer access.
   Keep peer evaluations and sensitive operational artifacts in restricted stores;
   the public index must not contain credentials, personal feedback or private data.
5. Complete actual review/retrospective/contribution and peer-evaluation records,
   record manager/supervisor decisions, and link submitted artifacts. Approval
   fields remain blank until the relevant people actually decide.

Production use still requires the separately authorized
[release gate](../../deploy/release/RELEASE_GUIDE.md). DDP-053 preparation does not
grant permission to deploy or change source-owned data. Keep ticket/release status
open until all three acceptance criteria have reviewed real evidence.
