# Review, contribution, evaluation and handover records

Status: PREPARED_BLANK. No attendance, effort, peer score, acknowledgement or
approval is inferred. Coordinator must obtain the actual Guide9/10/AppendixA
submission requirements and institutional privacy rules before finalizing.

## Sprint review and retrospective index

Include all required sprints, not just the retained release drafts. The existing
[v0.1.0 retrospective](../release/v0.1.0/RETROSPECTIVE.draft.md) and
[v0.2.0 retrospective](../release/v0.2.0/RETROSPECTIVE.draft.md) are drafts, not
evidence that the meetings occurred. Link actual reviewed records separately.

| Sprint / date | Actual participants | Review/demo evidence | Retrospective/actions | Action owners/due dates | Reviewer |
| ------------- | ------------------- | -------------------- | --------------------- | ----------------------- | -------- |
|               |                     |                      |                       |                         |          |

## Individual contribution register

Record each person's actual deliverables, source/PR/review links and design/test/
documentation/demo work. Preserve co-authorship and distinguish review from
implementation; do not manufacture time spent from commit counts. Use private
assessment records for personal information. Read-only local Git history can
help find evidence, but each entry needs reviewer attribution.

```powershell
git log --all --date=short --format="%h %ad %an %s"
```

| Contributor | Responsibility | Actual artifact / PR / commit | Review/test/demo evidence | Agreed effort record if required | Reviewer/date |
| ----------- | -------------- | ----------------------------- | ------------------------- | -------------------------------- | ------------- |
|             |                |                               |                           |                                  |               |

## Peer evaluation completion

Use the course's actual required form/rubric and submission channel. Store scores
and personal feedback in the restricted institutional location, not this repository
or public demo. This table tracks completion references only; it does not prefill
votes or represent evaluations as submitted.

| Required form/version | Evaluator reference | Submission date | Restricted receipt/reference | Verified by/date |
| --------------------- | ------------------- | --------------- | ---------------------------- | ---------------- |
|                       |                     |                 |                              |                  |

## Training and operational ownership

| Audience / actual trainee | Date | User/operator tasks actually completed | Limitations / follow-up | Trainer | Actual acknowledgement evidence |
| ------------------------- | ---- | -------------------------------------- | ----------------------- | ------- | ------------------------------- |
|                           |      |                                        |                         |         |                                 |

| Responsibility                             | Accountable person/team | Private access/contact reference | Backup owner | Acceptance/date |
| ------------------------------------------ | ----------------------- | -------------------------------- | ------------ | --------------- |
| Hotel manager support / account recovery   |                         |                                  |              |                 |
| Gateway/source contract support            |                         |                                  |              |                 |
| DB/schema/grants/backup/restore            |                         |                                  |              |                 |
| TLS/registry/host/monitoring/log retention |                         |                                  |              |                 |
| Release/rollback and emergency access      |                         |                                  |              |                 |
| Documentation/assessment submission        |                         |                                  |              |                 |

## Final review and submission

| Required decision                                       | Actual reviewer | Decision/conditions | Date | Evidence |
| ------------------------------------------------------- | --------------- | ------------------- | ---- | -------- |
| Demo/recording and artifact accessibility               |                 |                     |      |          |
| Final report/SRS/SDS/ADR consistency                    |                 |                     |      |          |
| Course rubric/contribution/peer evaluation completeness |                 |                     |      |          |
| Manager/hotel handover                                  |                 |                     |      |          |
| Supervisor/panel submission review                      |                 |                     |      |          |

Keep any rejected/conditional review and its resolution links. Actual UAT sign-off
is recorded in [SIGN_OFF.md](../uat/SIGN_OFF.md); release approval is separate.
