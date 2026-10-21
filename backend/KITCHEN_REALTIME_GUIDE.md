# Kitchen overview and live transport

DDP-026 frontend, DDP-041 snapshot API and the kitchen path through DDP-039.
Implementation date: 2026-10-20. No hosted SQL has been executed.

## Local setup

1. Review and manually execute `deploy/neon-mad-realtime.sql` in Neon after the
   shared schema and MAD auth supplement. It adds two private MAD event tables and
   an index. Adapt the commented grants for your restricted MAD runtime role.
2. Run `docker compose up --build -d`. Compose starts persistent `mad-rabbitmq`,
   enables the consumer and sets `MAD_SOCKET_PUBLIC_URL=http://localhost:4000`.
   Local broker defaults are username `mad`, password `mad-local-only`. If changing
   `RABBITMQ_PASSWORD`, also update `RABBITMQ_URL` with the URL-encoded password.
   Use private credentials for shared deployments.
3. For host-run development, backend/.env needs `MAD_REALTIME_ENABLED=true` and
   `RABBITMQ_URL=amqp://mad:mad-local-only@localhost:5672`. Frontend server env needs
   `MAD_SOCKET_PUBLIC_URL=http://localhost:4000`. Compose uses `mad-rabbitmq` as the
   broker hostname. Update the public socket URL if changing BACKEND_PORT.
4. Log in as a manager and open Food orders. The three columns remain: Pending,
   In Preparation, and Ready for Delivery plus Delivered inside the third column.
5. Arrange KMS publishing using the contract below. MAD cannot make an external
   KMS application publish automatically. Until then snapshots refresh every 30
   seconds, but event-driven integration is not ready for acceptance.

The current separate API gateway supports REST, not WebSocket upgrades. REST and
ticket issuance still use it; local sockets connect directly to MAD's port 4000.
For deployment, use an upgrade-capable proxy for `/mad/socket.io` and configure
`MAD_SOCKET_PUBLIC_URL` with its browser-reachable HTTP(S) origin. HTTPS frontend
requires HTTPS/WSS. The backend checks browser Origin against `FRONTEND_URL`.
This repository does not modify the separate API-gateway repository.

Run **one MAD instance** with this implementation. Tickets/subscriptions are local
to the instance. Multiple replicas require shared ticket storage, appropriate
routing and cross-instance fanout before deployment.

## Snapshot API

`GET /mad/kitchen/orders?status=READY&page=1&pageSize=20` requires a manager session
after first password change. Missing/invalid sessions return 401; disallowed roles
or first-login sessions return 403. Invalid/duplicate/unknown filters return 400.
Status is optional; page defaults to 1 (maximum 100000), pageSize to 20 (maximum100).
Pagination accepts decimal digit strings only; scientific notation, hexadecimal,
fractions and repeated parameters are rejected.

Mapping: PLACED = Pending; IN_PREPARATION = In Preparation; READY = Ready for
Delivery; DELIVERED = Delivered. CANCELLED orders disappear. Open orders have no
age cutoff. Delivered retention is today's midnight in Asia/Colombo through the
snapshot time. Confirm this explicit implementation policy with KMS.

Response: `orders`, `counts`, `total`, `page`, `pageSize`, `asOf`, `deliveredSince`.
Counts cover all four states regardless of page/status filter; total follows the
filter. Orders sort by placed_at then UUID. An order contains `id`, `roomNumber`,
`mealPeriod`, `status`, `placedAt`, `updatedAt`, `version`, `itemCount` (sum of
quantities). No guest, allergy, credential or special-note fields are returned.
Version is `(extract(epoch FROM updated_at)*1000000)::bigint`, a safe JS integer.
Keep PostgreSQL microseconds; JS Date alone loses sub-millisecond precision.

One parameterized SELECT provides snapshot consistency. Missing/denied sources or
unsafe numeric results return sanitized 503, never fabricated zero counts. All
responses are no-store. Offset pagination is a current view, not a frozen export;
concurrent changes can shift pages. The panel shows 100 orders/page with global
counts. Other food analytics cards/top-items mock content is outside DDP-026.

### DDP-041 source integrity and verification

The read model validates UUID identities, unique orders, the four supported states,
bounded room/meal labels, explicit-offset timestamps, safe integer quantities and
exact microsecond revisions. Counts, filtered totals and page lengths must agree.
Only documented response fields are projected; extra source fields are discarded.
Unknown source states, delivered orders without a completion timestamp and invalid
eligible item quantities make the source unavailable (503), rather than silently
disappearing into an apparently empty snapshot. A valid empty database or a page
beyond the last result still returns 200 with truthful global counts.

No additional schema supplement or frontend change is required for this work.
The existing realtime supplement and runtime read grants remain prerequisites.
KMS must still confirm the delivered-retention policy and implement its committed
event publisher; this repository cannot establish that external agreement.

Verification register (tests authored; execution and CI evidence pending):

| Acceptance | Coverage |
| --- | --- |
| TC-MAD-041-AC1 | Unit snapshots for all four states; PostgreSQL filtering, pagination, item sums, cancellation exclusion and inclusive retention boundaries |
| TC-MAD-041-AC2 | Existing PostgreSQL/RabbitMQ/Socket.IO integration checks committed source revisions against snapshot versions and duplicate handling |
| TC-MAD-041-AC3 | Empty and beyond-last pages, invalid filters, malformed snapshots, missing completion timestamps, denied sources and sanitized unavailable responses |
| Authorization | Existing integration checks missing/invalid sessions, non-manager roles and first-login restrictions |

Run the backend unit coverage and kitchen realtime integration suite in CI against
isolated test services. Do not run these integration tests against Neon. Passing
CI, external KMS contract adoption and staging propagation measurements remain
release acceptance requirements; implementation does not constitute that evidence.

## KMS producer contract

Durable topic exchange: `hotel.events`; routing key: `kitchen.order.changed`.
Durable MAD queue: `mad.kitchen`; invalid messages go to `mad.kitchen.dead`.

```json
{
  "eventId": "67f4568c-89ab-4c12-b321-123456789012",
  "type": "kitchen.order.changed",
  "orderId": "77f4568c-89ab-4c12-b321-123456789012",
  "version": 1792371600123456,
  "occurredAt": "2026-10-19T01:00:00.123456Z"
}
```

KMS must update its source order and insert an outbox event in the same transaction.
Use a strictly increasing updated_at, e.g. `greatest(clock_timestamp(), updated_at
+ interval '1 microsecond')`, deriving version from that returned value. Item
changes must bump the parent timestamp too. Publish creation, status changes and
cancellations after commit with persistent delivery and publisher confirms. Retry
the same UUID after an uncertain publish result. MAD does not implement the
external KMS producer/outbox or claim that it already follows this contract.

Events invalidate the view; source snapshots remain authoritative. MAD validates
the message and transactionally persists its UUID and latest per-order version
before acknowledging RabbitMQ. Duplicate/older/equal versions do not advance the
watermark. Pending dispatch survives restart. A 250 ms dispatcher emits before
marking delivered; crashes may duplicate emission, handled by the client. No
durable browser acknowledgement is assumed: reconnect and periodic snapshots
repair missed pushes. Broker/MAD healthy does not prove KMS is publishing.

Use separate broker credentials with restricted publishing permissions and TLS
for shared hosted connections. No credentials or event payloads are logged.

## Authentication and reconnect

The same-origin BFF checks Origin and uses the HttpOnly session cookie to call
protected `POST /mad/realtime/ticket`. The JWT never enters browser JavaScript.
A random ticket expires after 30 seconds, is consumed once, and goes in Socket.IO
auth, not the URL. Handshake revalidates Origin and the current manager session.
Expiry, logout revocation, role and forced-password-change flags are checked before
every push and on five-second transport heartbeats.

Disconnect retains the last snapshot with a stale banner. Reconnect delays are
1, 2, 4, 8 and 16 seconds, followed by visible offline state and manual Retry.
Reconnect reloads the snapshot. Event reloads are serialized/coalesced; duplicate
or older event versions cannot create duplicate rows. A 30-second reconciliation
also handles midnight retention. 401/403 clears data and stops automatic retries.

## Maintenance and verification

- Missing private tables leave live transport unavailable while snapshots may still
  work. Apply reviewed SQL manually; the consumer retries broker/storage failures.
  Inspect `docker compose logs mad-backend mad-rabbitmq` and the stale banner.
- Investigate dead letters with KMS; correct the producer before replaying. Do not
  silently purge unresolved messages. No automatic retention cleanup is included.
  Keep pending event rows, and keep per-order watermarks while old events can replay.
- CI supplies isolated PostgreSQL and RabbitMQ virtual host `mad_test`. Tests need
  a disposable `TEST_DATABASE_URL` containing `test` and `TEST_RABBITMQ_URL` ending
  in `/mad_test`. Never point them at Neon or a shared production broker.
- Backend unit and `test/kitchen-realtime.e2e-spec.ts` cover validation, authorization,
  real PostgreSQL/Socket.IO/RabbitMQ, duplicate persistence and source permissions.
  Frontend tests cover BFF privacy, groups, status moves, stale recovery and retries.
- Tests are authored, **not run locally**. CI coverage, provider agreement, 300-client
  load testing and real staging timings remain pending. Targets are propagation
  <=1 second and UI <=2 seconds, not measured guarantees. Production scaling and
  shared-gateway acceptance still need the external infrastructure work above.

References: [Socket.IO middleware](https://socket.io/docs/v4/middlewares/) and
[amqplib acknowledgement API](https://amqp-node.github.io/amqplib/channel_api.html).
