# Durable kitchen stock alerts - DDP-034

MAD consumes KMS stock changes, persists one current alert per menu item and emits
manager-authorized notifications. The event names below are a proposed integration
contract approved for this implementation on 2026-10-21. The KMS developer must
adopt/confirm the publisher contract; these wire names are not asserted SDS facts.
The Notifications UI, unread/read behavior and alert listing API belong to DDP-043.
No frontend styling or login flow changes are part of DDP-034.

## Manual setup

1. Review/apply `deploy/neon-mad-stock.sql` manually after the shared KMS schema.
   It creates only MAD current-alert and event/outbox tables. No SQL is run at
   application startup, and the implementation has not changed Neon.
2. Replace `mad_runtime` in its commented grants with your restricted runtime role.
   Grant SELECT on kms_menu_items(menu_item_id,name,stock_status,updated_at), and
   SELECT/INSERT/UPDATE on mad_stock_alerts and mad_stock_events. Do not grant KMS
   source writes to MAD. The SQL does not modify menu items.
3. Keep existing MAD_REALTIME_ENABLED=true, RABBITMQ_URL and authenticated socket
   transport settings. No new secrets or environment variables are required.
4. Rebuild the backend. Ensure RabbitMQ 4.x quorum queues/at-least-once dead-lettering
   are supported. The local Compose RabbitMQ service already uses the 4.x image.
   Monitor stock.transport.status, failed-work depth and pending outbox age.

Apply the supplement before enabling KMS stock publishing. Missing tables/grants
are processing failures and can exhaust retries; failed messages remain in the DLQ
for repair/replay. Never purge a production stock queue to fix a declaration error.
If a different existing queue named mad.stock uses incompatible arguments, plan a
reviewed drain/migration with the broker owner before enabling this declaration.

## KMS publisher contract

Use durable topic exchange `hotel.events`, routing key `kitchen.stock.changed`:

```json
{
  "eventId": "67f4568c-89ab-4c12-b321-123456789012",
  "type": "kitchen.stock.changed",
  "menuItemId": "77f4568c-89ab-4c12-b321-123456789012",
  "stockStatus": "LOW_STOCK",
  "version": 1792540800123456,
  "occurredAt": "2026-10-21T00:00:00.123456Z"
}
```

- UUID eventId and stable UUID menuItemId; eventId is immutable across redelivery.
- stockStatus: AVAILABLE, LOW_STOCK, UNAVAILABLE, TEMPORARILY_DISABLED.
- LOW_STOCK and either unavailable state activate an alert. AVAILABLE clears it.
  Temporarily Disabled retains its source label while being treated as unavailable
  for activation. Available before any alert creates an inactive version watermark.
- version is the exact safe-integer updated_at epoch microseconds from PostgreSQL.
  Read `(extract(epoch FROM updated_at)*1000000)::bigint` in SQL; converting a JS
  Date to milliseconds first loses the final three digits. Versions must strictly
  increase per item, including stock/name changes and rapid updates in one transaction.
- occurredAt is an ISO8601 timestamp with explicit offset or Z.
- Commit the source update and KMS transactional outbox together. Publish only
  after commit, persistently (`deliveryMode=2`), using publisher confirms. Do not
  overwrite event IDs, invent versions or publish client/browser credentials.
- Envelopes are at most 8192 bytes. Producer name/alert/count fields are ignored;
  MAD reads only the allowlisted authoritative KMS columns.
- This contract covers stock transitions, not hard deletion. Missing source items
  are retried and dead-lettered; a deletion/retirement policy requires agreement.

MAD rejects malformed envelopes immediately. If source version equals the event
but status contradicts it, or an existing eventId is reused with a different
normalized envelope, the event is dead-lettered as an invalid contract. A source
behind the event is retryable. A newer committed source is coalesced to current
state; a delayed Low Stock event cannot restore an alert after a newer recovery.

## Persistence and delivery

One database transaction serializes updates per menu item, checks event identity,
reads the authoritative source, upserts mad_stock_alerts and writes mad_stock_events.
The broker delivery is acknowledged only after this transaction commits. Matching
duplicate IDs skip source rereads, including during a later source outage.

The alert ID stays stable for the item. Raised/cleared timestamps record active
cycles; active status and version drive current counts. COUNT(*) WHERE active
counts each affected item once. Retain inactive recovery rows as ordering watermarks.
The inbox retains normalized received envelopes, even when superseded. No KMS
rows are written. Newer versions supersede older pending socket updates.

Socket dispatch retries committed pending rows every polling cycle. A failed send
or failed completion write leaves work pending for restart/retry. At-least-once
socket dispatch can duplicate a notification if a send succeeds before the DB mark;
clients must deduplicate by eventId/version and reconcile current durable state.

The existing manager-only, one-use ticket transport emits `stock.alert.changed`:

```text
{ eventId, type:"stock.alert.changed", menuItemId, version, occurredAt,
  alert:{ alertId,menuItemId,name,stockStatus,active,version,
          sourceUpdatedAt,raisedAt,clearedAt } }
```

`stock.transport.status` reports consumer health. Session access is rechecked on
every broadcast; revoked, worker or forced-password-change sessions cannot receive
stock data. There is no browser-to-server stock mutation handler. No new REST API
is introduced. Disconnected browsers need the DDP-043 snapshot/API on reconnect.
The existing one-instance socket/ticket limitation remains; shared ticket storage
and fan-out are prerequisites for multiple MAD instances.

## Bounded retry and dead-lettering

- Source queue `mad.stock`: durable quorum, delivery-limit 5, prefetch 1.
- DLQ `mad.stock.dead`: durable quorum, no delivery limit; failed work is retained.
- Source uses at-least-once dead-letter strategy, reject-publish overflow and explicit
  DLQ routing. Persistent publishing is required for dead-letter durability too.
- Invalid/oversized/contradictory messages are rejected without requeue into the DLQ.
- Processing/storage failures wait five seconds, then use basic.reject(requeue=true).
  Broker-persisted delivery counts bound retries across process/connection failures;
  after the initial delivery and up to five redeliveries the broker dead-letters it.
- Connection setup retries use a five-second delay. Shutdown closes the connection
  and clears retry timers; unfinished deliveries remain broker-owned.

basic.reject is deliberate: RabbitMQ 4.3+ does not count ordinary basic.nack returns
as genuine processing failures for its delivery limit. See the primary broker docs:
https://www.rabbitmq.com/docs/quorum-queues and
https://www.rabbitmq.com/docs/dlx . At-least-once dead-lettering needs quorum queues
with reject-publish overflow; do not silently replace them with classic queues.

Inspect x-death and the retained body when reviewing DLQ work. Repair source/grants
or publisher payload first, then persistently replay reviewed messages with confirms
before acknowledging the DLQ copy. Replay only into the isolated queue/route that
owns the event. Duplicate-safe processing prevents a replay from adding counts.
Do not delete recovery watermarks or unprocessed inbox rows as routine cleanup.

## Verification and remaining acceptance

Unit and integration tests were authored but NOT RUN locally, as requested:

- src/stock/stock-alerts.spec.ts: schema, duplicates, identity reuse, source failures,
  status/version consistency, authoritative coalescing and persistence.
- src/realtime/stock-consumer.spec.ts: queue arguments, commit-before-ACK, delayed
  retry/rejection, malformed DLQ, dispatch failure, shutdown and reconnect.
- src/realtime/realtime.spec.ts: manager-only stock updates and session revocation.
- test/stock.e2e-spec.ts: real disposable PostgreSQL + restricted role, alert counts,
  Available recovery, stale events, restart, socket failure, real RabbitMQ quorum
  delivery/DLQ/retry exhaustion and authenticated socket delivery.

Integration uses TEST_DATABASE_URL pointing to a disposable test database and
TEST_RABBITMQ_URL with the isolated `/mad_test` virtual host. The broker case takes
about 30 seconds to exercise retry exhaustion; its test timeout is 90 seconds.
It purges only the isolated test stock queues, never a production vhost.
Coverage gates: 80% global lines/branches; 90% branches for critical stock processing.
Passing tests, coverage, real KMS publisher interoperability, staging latency and
operator review remain pending evidence. The implementation does not claim those
external prerequisites have already been verified.
