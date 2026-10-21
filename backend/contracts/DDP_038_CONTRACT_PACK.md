# DDP-038 ownership and integration contract pack

Prepared 2026-10-21 from SRS/SDS, the planning coverage audit, current SQL and
implemented APIs. The project owner confirmed that cross-team decisions have
not yet been made and requested necessary preparation. **Status: prepared for
review, not cross-team approved.** No runtime/UI/permissions/schema changes,
test execution, external messages, release or Jira updates are part of this work.

This pack closes undocumented assumptions by giving them an explicit baseline,
proposal or blocking decision. It cannot establish approval, an owner's name,
a delivery date or a passing integration result without evidence.

## Read together

- [Implemented REST/BFF schemas, errors and examples](../API_CONTRACT.md)
- [Exact method/path inventory](endpoint-inventory.csv)
- [Metric examples and policy proposals](DDP_038_METRIC_EXAMPLES.md)
- [Decision/approval register](DDP_038_REVIEW_REGISTER.md)
- [ADR-038-001: current baseline and design deviations](decisions/ADR-038-001.md)
- [Manual SQL/setup and test-service runbook](../DEVELOPER_GUIDE.md)
- [All 22 MD identifiers and related requirements](../REQUIREMENT_TRACEABILITY.md)

Paths, event names, limits and proposal numbers below are implementation details
or review proposals, not quotations from the SRS. Existing project naming uses
DDP tickets and MAD subsystem/API prefixes. The pack describes source code, not
an inspection of the live Neon schema. Latest local schema references are in
ignored `docs/schema-review/`; they do not prove current deployed grants/data.

## Field-level ownership and permitted access

All objects are in PostgreSQL public schema. Existing unprefixed shared names are
compatibility contracts; no table rename or owner transfer is implied. The schema
owner applies reviewed supplements/grants manually. MAD never auto-synchronizes.
Functional owner roles below require a named representative in the review register.

| Source/object                                                                                                     | Fields consumed by MAD                                                                                                | Authoritative writer / allowed MAD writes                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staff_users` identity/profile                                                                                    | worker_id, full_name, vocation, email, age, phone, nic, username, role, is_active, updated_at                         | MAD account administration for create/profile/role/deactivate; subsystem owner agreement pending. No manager elevation via staff API.                                                                                                                                                        |
| `staff_users` credentials/session                                                                                 | password_hash, password_change_required, session_version, failed_attempts, locked_until                               | MAD seeds manager and provisions/resets staff; owning subsystem must atomically change its account password/session flags. Shared-write protocol requires all owners' agreement.                                                                                                             |
| `mad_revoked_sessions`, `mad_staff_deliveries`                                                                    | Revoked token digest/expiry; encrypted credentials, delivery version/status/lease metadata                            | MAD only; no provider plaintext password, hash, ciphertext or token in client APIs/logs.                                                                                                                                                                                                     |
| `bookings` -> `mad_booking_analytics`                                                                             | booking_id, check_in_date, status, updated_at                                                                         | HW/FDS must confirm booking write boundary; MAD SELECT only. Duplicate-view handling follows booking service's current-state rules.                                                                                                                                                          |
| `bookings` -> `mad_occupancy_allocations`                                                                         | booking_id, room_number as room_id, check_in_date, check_out_date, status, updated_at                                 | HW/FDS own booking/allocation lifecycle; MAD read-only. No inferred room allocation.                                                                                                                                                                                                         |
| `payments`                                                                                                        | payment_id, amount, payment_status, paid_at                                                                           | HW/payment owner to confirm, including FDS payment producers if applicable; MAD SELECT only. No refund-event ledger is invented.                                                                                                                                                             |
| `rooms`, `room_types`                                                                                             | room_number, room_type_id, status, floor, updated_at; type_name, price_per_night, max_guests                          | FDS/room-catalog owner to confirm; MAD SELECT only. Room identity is immutable string, not UUID.                                                                                                                                                                                             |
| `mad_room_availability`, `mad_room_maintenance` -> occupancy views                                                | room_number, active_from/active_to; start_date/end_date; updated_at                                                   | Operational history supplied by authorized owner through reviewed manual process; no MAD HTTP write API. Actual dates required.                                                                                                                                                              |
| `foss_service_requests`                                                                                           | request_id, status, submitted_at, completed_at, updated_at                                                            | FOSS only; MAD SELECT for analytics.                                                                                                                                                                                                                                                         |
| `foss_complaints`                                                                                                 | complaint_id, category, description, referenced_worker_id, submitted_at, status, resolved_at, updated_at              | FOSS owns creation/content/reference; user-approved MAD exception explicitly updates **status/resolved_at** only during allowed transitions. updated_at advancement is a source-owner/trigger agreement, not an additional MAD SET clause. FOSS owner must ratify concurrent-write protocol. |
| `mad_complaint_state/history/outbox`                                                                              | Optimistic version, manager-only note/actor/status history; note-free event payload                                   | MAD only. No FOSS overwrite of manager history or notes.                                                                                                                                                                                                                                     |
| `kms_food_orders`, `kms_food_order_items`                                                                         | order_id, room_number, meal_period, status, placed_at, updated_at; order_id, menu_item_id, name, quantity, updated_at | KMS owns changes; FOSS/KMS must confirm order submission boundary; MAD SELECT only. No guest/allergy/special-note projection.                                                                                                                                                                |
| `kms_menu_items`                                                                                                  | menu_item_id, name, stock_status, updated_at                                                                          | KMS only; MAD SELECT. Stock state is not inferred from quantities.                                                                                                                                                                                                                           |
| `wkms_tasks`                                                                                                      | task_id, room_number, category, priority, status, assigned_worker_id, submitted_at, completed_at, updated_at          | WKMS only; MAD SELECT. No claim/assign/complete writes. FDS/FOSS request producers coordinate through WKMS.                                                                                                                                                                                  |
| `mad_promotion_codes`, `mad_promotion_room_types`, `mad_promotion_outbox`                                         | Promotion fields/version/deletion/redemptions, room associations and publication work                                 | MAD owns offer terms/lifecycle; HW redemption counter/write protocol and publication acknowledgement remain DDP-040 agreement. No arbitrary HW shared write grant.                                                                                                                           |
| `mad_realtime_versions/events`, `mad_room_versions/events`, `mad_task_versions/events`, `mad_stock_alerts/events` | Inbox identity/revisions, safe source projection and durable socket dispatch                                          | MAD only; source owners publish events, not direct writes to these tables.                                                                                                                                                                                                                   |
| Task-limit policy                                                                                                 | default/effective value, policy version and acknowledgement (proposed)                                                | MAD configuration/WKMS atomic claim enforcement proposed; no policy storage/API yet (DDP-045).                                                                                                                                                                                               |

Column spellings and actual query/grant allowlists are authoritative in
[manual supplements](../../deploy), [analytics SQL](../src/analytics),
[snapshot services](../src) and [API response contracts](../API_CONTRACT.md).
This table is a responsibility map, not executable GRANT SQL. Runtime roles must
not own shared source tables or inherit blanket source UPDATE/DELETE privileges.
Use [read-only role audit](../../deploy/security-role-audit.sql) manually as the
runtime role. Do not use the Neon owner account as proof of restricted access.

## API ownership, authentication and concurrent writes

MANAGER can use the implemented dashboard APIs after first-password change.
Missing/invalid/expired/revoked sessions return401; valid disallowed role403;
first-login dashboard access403 PASSWORD_CHANGE_REQUIRED. KITCHEN_MANAGER is
currently denied MAD access; the SDS partial role remains an explicit open
requirement, not silently removed. Its least-privilege proposal is in the register.

The gateway routes REST only. Each subsystem issues its own login sessions; it
does not use MAD's signing secret/issuer/audience merely because accounts share
staff_users. MAD sessions are HS256/eight hours/audience mad and require new login
after expiry. Every owner must check its account's activation, role, version and
password-change flag on protected operations; signature-only verification is
insufficient. Cross-service JWT portability is not promised.

MAD provisions/reset staff passwords as bcrypt cost12; current manager auth uses
scrypt. This is a recorded SDS/NFR hashing discrepancy requiring review, not a
claim of bcrypt-only compliance. Actual subsystem hash verifiers and migration
compatibility must be confirmed before real staff first-login acceptance.

Staff changes lock the row and increment session_version; existing manager seed
accounts are never reset. Other credential writers must participate atomically.
Reset retries generate new credentials: do not retry blindly after timeout.
Complaint transitions require a note and version, row locking and MAD state/history
within one transaction. FOSS must not update shared complaint status independently
while bypassing the version/history protocol; agree a single command authority or
compatible transaction protocol before concurrent production use. Promotion writes
likewise require the current version; deletion is logical and irreversible.

Backend error envelope:

```json
{ "code": "CONFLICT", "message": "The record changed. Reload and review it." }
```

Codes/statuses and validation detail shape are listed in the API reference. Server
failures omit internal messages/codes/details. Browser BFFs may return code-only
errors; framework404/405 and broker rejection are separate transports, not forced
into REST envelopes. Unknown fields/invalid IDs yield400 before domain mutations;
nonexistent targets404. Auth and health have explicitly documented exceptions.

## Events, schemas and versions

Current broker envelopes do **not** contain schemaVersion. `version` is the
source entity's monotonic revision, normally exact PostgreSQL updated_at epoch
microseconds (safe integer). It is not an API version or delivery retry count.
An event ID is stable across retries; source row identity cannot be reassigned.
Commit source/outbox together, publish persistently with publisher confirms to
durable topic `hotel.events`, then retry with the same ID. Payload cap8192bytes.
Consumers reread authorized source fields, reject malformed envelopes and only
ACK after durable MAD persistence. Reconnect/refetch recovers snapshots; it does
not prove no events were lost in an external publisher.

| Owner | Routing key/type      | Payload in addition to eventId/type/version/occurredAt                            | Exact contract and replay behavior                                                    |
| ----- | --------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| KMS   | kitchen.order.changed | orderId UUID                                                                      | [Kitchen](../KITCHEN_REALTIME_GUIDE.md); mad.kitchen / mad.kitchen.dead               |
| FDS   | room.status.changed   | roomId string1..10                                                                | [Rooms](../ROOM_STATUS_GUIDE.md); mad.rooms / mad.rooms.dead                          |
| WKMS  | task.changed          | taskId UUID                                                                       | [Tasks](../OPERATIONS_GUIDE.md); mad.tasks / mad.tasks.dead                           |
| KMS   | kitchen.stock.changed | menuItemId UUID, stockStatus AVAILABLE/LOW_STOCK/UNAVAILABLE/TEMPORARILY_DISABLED | [Stock](../STOCK_EVENTS_GUIDE.md); quorum mad.stock / mad.stock.dead, bounded retries |

Example WKMS envelope (source/outbox must already be committed):

```json
{
  "eventId": "67f4568c-89ab-4c12-b321-123456789012",
  "type": "task.changed",
  "taskId": "77f4568c-89ab-4c12-b321-123456789012",
  "version": 1792540800123456,
  "occurredAt": "2026-10-21T00:00:00.123456Z"
}
```

The timestamp/version values are illustrative wire fields, not timing evidence.
Never reconstruct a source version by multiplying a millisecond-only JS Date.
Stock Available clears, low/unavailable/temporarily-disabled activate; duplicate/
stale messages cannot resurrect an older alert. Hard source deletion has no agreed
event: retain a tombstone/retirement agreement before publishing deletion events.
Stock's quorum bounded retry contract must not be attributed to the other queues.

MAD's promotion and complaint **private outboxes** are documented in the API
reference. Neither has a completed external delivery/ack contract here. Do not
invent a promotion broker envelope, claim website application from queue state,
or include complaint notes in public events. Those gaps belong to HW/DDP-040 and
notification/DDP-043 reviews.

Compatibility proposal: additive optional fields may be ignored by existing
consumers only after compatibility tests. Renames, required fields, semantics,
enum additions unsupported by old validators, identity or version changes need
an agreed new routing/schema contract, consumer rollout/dual-read plan and replay
cutover. Do not add schemaVersion to existing strict contracts without agreement.
Owner review is required before asserting this proposal as a team standard.

## Timing, infrastructure and delivery commitments

SRS event propagation<=1second and UI<=2seconds conflict with SDS's UI<=1second.
Proposed resolution is the stricter **<=1second source-commit-to-visible-update**
target on healthy integrated live paths, which also satisfies the SRS upper bound.
It is not a measured result. Instrument source commit, broker delivery, MAD
persistence and browser render with correlation IDs and synchronized clocks;
occurredAt alone is not proof of commit time. Agree percentile/workload/network
profile before performance sign-off (including 300 connections/users). A degraded
30second reconciliation poll is recovery behavior, not a live-latency pass.

Infrastructure review includes restricted broker credentials/vhosts, queue policy,
TLS/WSS upgrade routing, origin matching, redacted logs/retention, actual DB grants,
backup/restore and one MAD instance until shared ticket/fanout exists. No automatic
database migration or cross-repo deployment is introduced by this pack.

| Deliverable / functional reviewer                                                             | Original planning milestone | Actual person / calendar delivery / sign-off |
| --------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------- |
| MAD maintainer + all subsystem representatives: contract review                               | End week1                   | Unassigned / unconfirmed / pending           |
| HW + FDS: booking/allocation/payment status and refund policy fixtures                        | Week2                       | Unassigned / unconfirmed / pending           |
| MAD + FDS/KMS/WKMS: staff profile/hash/login/version protocol; infrastructure: verified email | Week3                       | Unassigned / unconfirmed / pending           |
| FOSS + KMS + infrastructure: complaints/requests/orders and broker/socket                     | Week5                       | Unassigned / unconfirmed / pending           |
| HW publication; FDS room events; KMS stock; WKMS analytics                                    | Week6                       | Unassigned / unconfirmed / pending           |
| KMS kitchen snapshot/events; WKMS task snapshot/events                                        | Week7                       | Unassigned / unconfirmed / pending           |
| MAD + WKMS task-limit bounds/version/enforcement                                              | Week8                       | Unassigned / unconfirmed / pending           |
| Infrastructure: backup/logging/monitoring                                                     | Week10                      | Unassigned / unconfirmed / pending           |
| All actual providers integrated in staging                                                    | Week11                      | Unassigned / unconfirmed / pending           |

Milestone weeks come from the planning review and are not accepted dates or
evidence they were met. No project start date or named representative was supplied.
The former central Auth review responsibility is reassigned **provisionally** to
each subsystem's login owner plus infrastructure under the user-directed design;
there is no central Auth service to schedule or contact. Review this deviation
with the supervisor within one sprint of formal proposal acceptance, per Guide
requirements; do not invent a historical supervisor approval or calendar deadline.

## Completion gate

The [review register](DDP_038_REVIEW_REGISTER.md) records named blocking decisions
and acceptance cases. Each required interface needs a real accountable person,
accepted payload/data/write protocol, date, review record and provider evidence.
Until then DDP-038 is prepared, **not Done**. No dependent interface may be called
agreed merely because code or contract fixtures already exist.
