# DDP-038 blocking decisions and acceptance register

Prepared 2026-10-21. The project owner states that the teams have not decided yet.
No approval, delivery date, actual person, issue URL or execution outcome is
invented. IDs B-038-\* below are local decision labels, not Jira issues. Replace
role assignments with actual accountable people and agreed dates during review.

## Decisions requiring explicit disposition

| ID               | Conflict / decision                                                              | Existing baseline or concrete proposal                                                                                                                                                                                                                                                     | Accountable reviewers / status                                                                                          |
| ---------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| B-038-AUTH       | Central Auth in SDS6.1 versus user-directed separate logins/routing-only gateway | Implemented: independent subsystem issuance, MAD managers only, eight-hour HS256/audience mad, no refresh; retain new login on expiry. No 15minute/7day refresh policy.                                                                                                                    | MAD + each subsystem login owner + supervisor: people/date/approval pending.                                            |
| B-038-HASH       | SDS/NFR bcrypt-only requirement versus manager scrypt                            | Staff create/reset bcrypt12; current manager auth scrypt; no hash migration in this docs task. Choose an approved verifier/migration approach without breaking existing accounts.                                                                                                          | MAD/security representative + supervisor: blocked pending review; do not assert full hashing compliance.                |
| B-038-KM         | SDS6.2.1 KITCHEN_MANAGER partial MAD access has no precise routes                | Proposal: initial read-only Kitchen page and GET `/mad/kitchen/orders` only, plus a future kitchen-scoped ticket/channel; no staff/promotions/complaints/revenue/room/task/admin access. Stock pages only after DDP-043 has a separately approved scope.                                   | MAD + KMS + security reviewer: blocked. Current manager-only login/guards remain unchanged.                             |
| B-038-KM-SESSION | Separate login design versus partial MAD access                                  | Decide manager-dashboard role-specific login versus an approved KMS-issued scoped integration mechanism; never reuse a manager token or blanket signing key. Scoped sockets must filter server-side before granting KM access.                                                             | MAD + KMS + infrastructure: blocked; current generic socket stream is MANAGER-only, not safe to expose wholesale to KM. |
| B-038-LATENCY    | SRS NFR-03 UI<=2seconds vs SDS1.4.3<=1second; events<=1second                    | Proposal: stricter healthy-path source-commit-to-visible<=1second, component timestamps/correlation IDs, agreed workload/network/percentile. Polling recovery is not compliance evidence.                                                                                                  | Infrastructure/performance + owners + supervisor: proposal pending acceptance and measurements.                         |
| B-038-COMPLAINT  | FOSS ownership vs MAD status/resolved-time writes                                | Existing user-approved field exception, MAD note/history private. Agree FOSS concurrent writers must share the version/history protocol or delegate the command to MAD. No independent blind status writes.                                                                                | FOSS + MAD + schema owner: actual grants/protocol/delivery date pending.                                                |
| B-038-STAFF      | Who may provision/change/reset credentials and enforce sessions?                 | MAD account administration and encrypted email delivery; owning system first-password change and per-request activation/role/version enforcement. Shared row/lock/version protocol and supported hash format required.                                                                     | MAD + FDS/KMS/WKMS owners + email infrastructure: pending integration proof.                                            |
| B-038-SCHEMA     | Prefixed service-owned SDS tables vs unprefixed shared schema                    | Keep current object/field compatibility mapping, reviewed read-only reporting views or source SELECT, narrowly authorized write exceptions; no automatic rename/sync/migration.                                                                                                            | Schema owner + affected subsystem owners: deployed-schema/grant confirmation pending.                                   |
| B-038-CI         | Guide early integration gates vs SDS integration after main                      | Current CI runs all jobs on every push and PRs targeting develop/main. Proposal: retain stronger earlier checks; staging after develop/production after main with manual approval needs actual deployment workflow and infrastructure agreement. No such deployment automation is claimed. | Repository maintainer + infrastructure + supervisor: reconcile deployment policy; people/date pending.                  |
| B-038-PROMO      | HW publication/withdrawal/redemption and acknowledgement                         | MAD outbox/lifecycle publisher and retry exist; actual HW delivery/ack/idempotency/redemption contract adoption and ownership remain pending. Do not equate queue state with website acceptance.                                                                                           | MAD + HW: blocked; wire contract/delivery date unconfirmed.                                                             |
| B-038-EVENTS     | Source event/revision authority and schema compatibility                         | Adopt current kitchen/room/task/stock contract examples; exact updated_at microseconds and stable event IDs. No schemaVersion currently. Agree breaking-version rollout/replay and deletion policy.                                                                                        | KMS/FDS/WKMS + infrastructure: producer adoption and dates pending.                                                     |
| B-038-METRICS    | Timezone/comparison/status/refund/capacity/cohorts                               | Local implemented policies and examples documented; completed-payment metric excludes refunded rows and is not a refund ledger. No capacity/history guesses.                                                                                                                               | MAD + HW/FDS/FOSS/KMS/WKMS data owners: review examples and actual views/data sources.                                  |
| B-038-POLICY     | Task limit default3, unspecified bounds/cohort/enforcement                       | Project owner approved integer1..10/default3 and assigned ASSIGNED/IN_PROGRESS/ESCALATED active. MAD versioned requests/confirmed-state flow and shared-DB handoff now implemented; WKMS must adopt activation and atomic count+claim protocol.                                            | MAD scope implemented; actual WKMS owner sign-off, grants, production enforcement and staging evidence pending.         |
| B-038-OPERATIONS | Load, latency, source availability and recovery definitions                      | Agree300-connection/user profile, realistic dataset/event rates, measurement percentile, TLS/WSS, single-instance constraints, queue/grant checks and downtime evidence.                                                                                                                   | Infrastructure/performance + provider owners: pending workload and operational sign-off.                                |

Partial access is deliberately a proposal, not an authorization change. The task
limit range is a proposed product decision, not a hidden change to SRS/defaults.
User direction authorizes preparing these proposals, not claiming other owners
or the supervisor approved them. Use [ADR-038-001](decisions/ADR-038-001.md) for
the documented deviations and required supervisor-review trail.

## Required owner response record

For each row and interface, capture: named accountable person, subsystem,
approved/rejected/revised proposal, exact contract revision/commit, accepted
calendar delivery date, review date/meeting or PR URL, supervisor disposition if
required, provider test-service/staging evidence, and unresolved issue link.
All are currently pending. Original week milestones are in
[the contract pack](DDP_038_CONTRACT_PACK.md); do not convert them to calendar dates
without a real project start date and owner commitment.

## Acceptance and verification cases

Priority High for all cases. Type contract/document review + later real-provider
integration. No automated test or hosted SQL execution occurred in this task;
documentation-only code coverage is N/A. Source-checking does not prove peer
agreement, latency, revocation in another system or successful real delivery.

| ID             | Requirement                          | Preconditions/input                                                        | Expected                                                                                        | Actual / evidence / status                                                                                                                                  |
| -------------- | ------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-MAD-038-AC1 | MD identifiers; SDS1.4/1.5.2/2/6/7.5 | Current controllers/DTOs, field queries, SQL and provider representatives  | Field ownership, writes/reads, payload/error/version contracts, named owners and dates accepted | Pack prepared and source-reviewed; owner/date/approval evidence absent, **pending**. [Pack](DDP_038_CONTRACT_PACK.md), [API](../API_CONTRACT.md).           |
| TC-MAD-038-AC2 | SRS NFR-12; Guide conflicts          | Compare SRS/SDS, user design direction and actual login/CI/ownership       | Each conflict explicitly resolved or assigned named blocking decision                           | Local B-038-\* decisions recorded; role-level reviewers assigned, actual people/sign-offs absent, **pending team review**. [ADR](decisions/ADR-038-001.md). |
| TC-MAD-038-AC3 | Analytics/settings contracts         | Hand-calculated example fixtures + actual provider views and policy owners | Deterministic calendar/revenue/refund/capacity/cohort/threshold/task-bound cases adopted        | Examples supplied, including bounds proposal; no owner adoption or test execution, **pending**. [Examples](DDP_038_METRIC_EXAMPLES.md).                     |

Candidate real tests: [bookings/revenue](../test/bookings.e2e-spec.ts),
[occupancy](../test/occupancy.e2e-spec.ts),
[service analytics](../test/service-request-analytics.e2e-spec.ts),
[worker analytics](../test/worker-performance.e2e-spec.ts),
[staff](../test/staff.e2e-spec.ts), [complaints](../test/complaints.e2e-spec.ts),
[promotions](../test/promotions.e2e-spec.ts),
[rooms](../test/rooms.e2e-spec.ts), [kitchen](../test/kitchen-realtime.e2e-spec.ts),
[tasks](../test/tasks.e2e-spec.ts), [stock](../test/stock.e2e-spec.ts).
These are candidate coverage references, not assertions every proposed policy is
already tested. KM scoped access, task-limit enforcement, HW publication/ACK and
the proposed latency profile still need implementation/acceptance where absent.

Do not mark DDP-038 Done or remove dependency blockers while required interfaces
are unassigned/unapproved. The project owner can use this pack directly at the
cross-subsystem review; no further code or external messages are needed to make
the decisions concrete and reviewable.
