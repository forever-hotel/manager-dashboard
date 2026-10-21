# DDP-039 reliable real-time transport

Reviewed/updated 2026-10-21. Implementation and regression coverage are prepared;
tests were not run locally. Real producer adoption, staging timing/load evidence,
DDP-038 owner approvals and upgrade-capable deployed routing remain pending.
Existing UI, manager-only permissions and separate subsystem logins are preserved.

## Implemented path

1. KMS/FDS/WKMS commits authoritative source state with its transactional outbox,
   then publishes persistent, confirmed messages to durable topic `hotel.events`.
2. MAD validates the envelope, serializes entity revisions and commits its durable
   inbox/version record before broker ACK. Source-specific consumers own their
   projections; browser clients do not trust producer payloads as rendered state.
3. An authenticated manager obtains a one-use ticket through POST
   `/mad/realtime/ticket` (201) or the browser `/api/realtime/ticket` alias (200).
   JWTs remain server-side in the BFF; tickets are 32 random bytes/base64url.
4. Socket.IO connects at `/mad/socket.io` with WebSocket transport and `{ticket}`
   handshake auth. Exact frontend Origin and current manager session are required.
5. Validated versioned events trigger authoritative REST snapshot reloads. Failed
   sends remain durable pending work; reconnect/refetch reconciles missed updates.

Ticket lifetime is **strictly less than30seconds**: at the expiry instant it is
invalid. A ticket is consumed once, including failed authorization attempts.
Malformed/missing handshake auth is rejected as UNAUTHENTICATED without throwing
an unhandled shape error. Outstanding tickets are capped at1000 per instance.
Active subscriptions recheck activation, role, expiry, revocation, session version
and forced-password-change state on every send and five-second status heartbeat.
Changed/unauthorized sessions disconnect. No Kitchen Manager access is silently
enabled while DDP-038's partial-role/session agreement is pending.

## Durability and kitchen identity safeguards

Kitchen event shape is `{eventId:UUID,type:"kitchen.order.changed",orderId:UUID,
version:safeInteger>=0,occurredAt:ISO8601WithOffset}`. Inbound UUIDs are normalized
to lowercase; old persisted envelopes are normalized when compared. Unknown
producer fields are discarded. Malformed/oversized messages go to the existing
dead-letter queue. Reusing an event ID with different normalized identity,
revision or timestamp is a permanent contract failure, not a harmless duplicate:
it is dead-lettered without overwriting the persisted receipt or high-water mark.

Version checks are transactional under an entity advisory lock. Duplicate identical
events do nothing; lower/equal revisions do not replace the latest state. When a
new revision commits, older unsent kitchen invalidations are retired in the same
transaction; their inbox receipts remain for deduplication/audit. A restart sends
the pending latest invalidation. `mad_realtime_events.delivered_at` means **no
further dispatch required**, including stale/superseded receipts; it is not proof
that a browser acknowledged or rendered an event. Existing schema is reused.

Socket dispatch is at least once at the application boundary: a send followed by
a failed database mark can be repeated. Kitchen clients deduplicate versions;
all boards reload authoritative snapshots rather than overwriting source state
from a delayed event. Superseding an older invalidation is safe because the newest
one requests the full current snapshot. A concurrently in-flight older message
can still arrive; version filtering/refetch makes it harmless.

Transient persistence failures leave delivery unacknowledged and reconnect after
the existing bounded delay. Kitchen/room/task queues remain their existing durable
types and do not gain the stock quorum retry policy in this ticket. Permanent
kitchen identity conflicts explicitly dead-letter. See [stock guide](STOCK_EVENTS_GUIDE.md)
for that queue's separate bounded retries/at-least-once DLX behavior. Never purge
queues or manufacture new IDs to hide an invalid publisher; repair and replay
using the owning service's reviewed procedure.

## Client reconnect and protected snapshots

Kitchen, rooms and tasks use fresh tickets for reconnects, Socket.IO automatic
reconnection disabled, exponential delays1/2/4/8/16seconds and at most five retries
after the initial connection. Exhaustion leaves the visible offline state and
manual Retry. A successful connection reloads the snapshot. Current filters/page
are retained; periodic30second reconciliation also repairs missed invalidations.
The poll is recovery behavior, not proof of live latency.

401/403 from either ticket or snapshot stops reconnection and clears protected
data. Kitchen responses now check terminal auth failure both before and after
JSON parsing: a delayed successful fetch cannot restore protected rows or replace
the sign-in/permission message after a concurrent ticket rejection. Manual Retry
starts a new attempt cycle; it never bypasses server session enforcement.

## Setup, routes and operational limits

No new SQL or env variables are introduced. Review/apply the existing manual
`deploy/neon-mad-realtime.sql` and corresponding room/task/stock supplements and
grants before enabling their consumers. Application startup never migrates Neon.
Use MAD_REALTIME_ENABLED=true and the correct private RABBITMQ_URL. Host-run broker
uses localhost; local Compose uses mad-rabbitmq. See
[developer runbook](DEVELOPER_GUIDE.md) for full configuration/disposable services.

Local REST goes through the separate gateway, which does not implement WebSocket
upgrades. MAD_SOCKET_PUBLIC_URL points to the browser-reachable backend4000 or
an upgrade-capable proxy; FRONTEND_URL must match the browser Origin. Use HTTPS/WSS
for a deployed HTTPS frontend. Run **one MAD instance**: tickets and connected
subscriptions are in memory. Replicas need shared tickets/routing/fanout first.
Health events distinguish broker streams; basic HTTP readiness does not prove
the queues, providers or live performance are ready.

Producer ownership/version/compatibility and undeclared promotion/complaint
publication paths remain in the [DDP-038 pack](contracts/DDP_038_CONTRACT_PACK.md).
DDP-039 does not implement DDP-040 website publication or DDP-043 alert listing.

## Acceptance and regression register

All cases High priority. Actual result: **NOT RUN locally**. Attach actual final
SHA, CI run, coverage artifact and redacted staging/provider evidence before
claiming acceptance. Unit tests isolate dependencies; integration uses disposable
PostgreSQL and RabbitMQ `mad_test`, never the Neon application database.

| ID                | Case / preconditions / input                                                                                                             | Expected                                                                                                                                            | Candidate tests / evidence status                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| TC-MAD-039-AC1    | Current manager, committed broker event, one-use ticket; absent/worker/revoked session, invalid Origin/auth shape, exact expiry boundary | Event ID/type/revision/timestamp delivered; unauthorized subscriptions rejected, no private data                                                    | `test/kitchen-realtime.e2e-spec.ts`, `src/realtime/realtime.spec.ts`; authored, execution pending                    |
| TC-MAD-039-AC2    | Duplicate/stale events, restarted consumer, unsent earlier revision, reused ID with changed content, transient DB/socket failure         | One immutable receipt per identity; latest revision retained; permanent conflicts dead-letter; pending work survives restart; ACK only after commit | Above integration suite, `src/realtime/realtime-consumer.spec.ts`; authored, execution pending                       |
| TC-MAD-039-AC3    | Socket disconnect, six total failed connection attempts, manual Retry, reconnect, delayed snapshot after ticket401/403                   | Authoritative reload, bounded backoff, no retries after exhaustion until manual action; protected data never restored after denial                  | Frontend `test/kitchen.test.tsx`, `test/rooms.test.tsx`, existing `test/tasks.test.tsx`; authored, execution pending |
| TC-MAD-039-TIMING | Actual providers and agreed load/network profile, synchronized timestamps/correlation ID                                                 | Baseline SRS event<=1second/UI<=2seconds; DDP-038's stricter1second UI proposal requires owner agreement                                            | No timing claim from fixtures; staging measurement pending                                                           |

Run the existing CI unit/coverage/integration/component checks against this change.
The real broker/socket suite covers committed delivery; version/dedup/restart tests
cover durable state; component fixtures cover reconnect and denial races. None is
substitute evidence for300 concurrent connections or real provider timing/adoption.
