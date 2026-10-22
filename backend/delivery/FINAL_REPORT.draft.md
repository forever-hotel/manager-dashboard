# Manager dashboard final report - draft

Target submission: v1.0.0. **Not submitted, published or accepted.** Prepared
2026-10-22 from baseline27b3c315b32f92d19010d5d019d5804bb17db204. Replace this
header with the final candidate/version/date only after the release and assessment
gates pass. Obtain the course's actual report template, word limits, rubric,
referencing rules and required appendices before submission.

## Problem and delivered scope

The hotel manager needs one administrative view of bookings/revenue/occupancy,
food/service/worker metrics, operational status, staff accounts, promotions,
complaints, persistent alerts, task policy and exports across six hotel systems.
The requirement matrix contains22 MD identifiers including suffix requirements,
plus SRS task-policy, accessibility and security obligations. The implementation
and candidate test references are in [traceability](../REQUIREMENT_TRACEABILITY.md);
source presence alone is not final requirement acceptance.

## Architecture and design decisions

Next.js renders the manager UI and forwards same-origin API requests through a
server-side BFF with an HttpOnly session cookie. NestJS owns manager authentication
and MAD APIs. The separate shared gateway routes APIs; each subsystem owns login.
PostgreSQL is hosted on Neon, with source-table ownership and manually reviewed
schema supplements/grants. Runtime synchronization/migrations are disabled.
RabbitMQ supplies owner events; authenticated one-use socket tickets and current
source snapshots support live views/reconciliation. Current transport requires
one active MAD instance until shared ticket/fan-out support exists.

MAD writes staff/promotion/complaint/settings changes under reviewed ownership
rules, with version/conflict handling. Room/task/kitchen source writes remain in
FDS/WKMS/KMS. Independent staff login/session enforcement, actual HW checkout and
WKMS atomic claim adoption require provider evidence. Read
[current decisions](../CONTRACT_DECISIONS.md),
[contract pack](../contracts/DDP_038_CONTRACT_PACK.md) and actual
[ADR-038-001](../contracts/decisions/ADR-038-001.md). Owner/supervisor agreement
must not be inferred where those decision records remain pending.

## Implementation and operational choices

Booking counts use check-in date; completed-payment revenue uses paid_at/LKR cents
and whole previous periods. Occupancy distinguishes unknown capacity from zero.
Promotions retain codes/history after logical deletion; complaints follow a
non-reopening review/resolution path. Active notifications persist independently
of read receipts. Task-limit requests remain pending until an exact WKMS ACK.
Analytics exports share source aggregations rather than inventing another policy.

Configuration, API/event details and user/operator walkthroughs are linked in the
artifact index. CI checks application code, containers and browser flows. Staging
publishes commit-tagged images and deploys by digest with readiness/login smoke
and recovery records. Production preparation promotes accepted immutable images
from reviewed main behind owner approval and host-owned traffic/fencing hooks.
Audit, retention/monitoring/backup templates and isolated reconciliation support
operations; configured infrastructure and restore evidence are still required.

## Verification and results to attach

The repository contains unit/component, BFF/browser, disposable PostgreSQL/API and
real-time contract tests, plus integration/UAT/accessibility/performance/recovery
registers. No tests were executed by this documentation task. Populate actual
candidate CI/test totals, measured changed-code80% line/branch and critical90%
branch results, audit findings, cross-service outcomes, accessibility walkthroughs,
100/300-user measurements, restore/rollback timings and actual UAT decisions here.
Do not fill this section with configured thresholds as measured results.

| Result area                                      | Actual candidate outcome / evidence |
| ------------------------------------------------ | ----------------------------------- |
| CI/unit/component/API/browser/container          |                                     |
| Security and role/grant review                   |                                     |
| Real-provider integration                        |                                     |
| Performance/capacity/live latency                |                                     |
| Screen-reader/zoom/contrast accessibility        |                                     |
| Log retention/backup/isolated restore            |                                     |
| Two-minute release recovery and compatibility    |                                     |
| Manager/supervisor UAT and closed blockers       |                                     |
| Complete demo/role/export rehearsal and fallback |                                     |

## Limitations and remaining work

Known gaps include DDP-057's visible low-demand suggestion/date-prefill, pending
provider adoption/contract decisions, actual infrastructure/evidence and unrecorded
client/supervisor approvals. Exact current disposition belongs in the UAT defect/
readiness registers and release checklist. Templates or mocked development
contracts do not close real-provider acceptance. Document lesser limitations,
owner/date/workaround and explicit actual reviewer disposition before submission.

## Evaluation, contribution and handover

Attach actual sprint review/retrospective records, contribution evidence and
required peer evaluation using the approved course process. Git authorship or
commit counts alone do not prove responsibility/quality. Link individual work
artifacts, reviewed PRs, test evidence and presentations without fabricating effort,
attendance, marks or approvals. Complete the user/operator handover and named
support/access ownership records. Maintain restricted access to private evaluation
and operational data.

## Submission completion

Replace draft results with actual findings and references, attach approved SRS/SDS
versions/change history, reconcile design deviations/ADRs, review the course
rubric and accessibility of every artifact, then obtain real supervisor/client
approval. Publish final v1.0.0 notes/tag only through the authorized release gate.
This draft is not permission to deploy or claim assessment completion.
