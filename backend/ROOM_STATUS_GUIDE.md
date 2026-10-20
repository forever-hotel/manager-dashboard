# Room snapshots and updates (DDP-027)

MAD reads FDS room data and broadcasts authorized updates. It never assigns rooms
or modifies room status. DDP-028 connects the room board to this read-only API.

## Snapshot contract

`GET /mad/rooms/status` returns every source room, ordered by room number using
PostgreSQL C collation. No filters or pagination are accepted; extra parameters
return 400. Manager authentication and completed first-login password change are
required. Missing/invalid sessions return 401; disallowed sessions return 403.

```json
{
  "source": "FDS",
  "readOnly": true,
  "queriedAt": "2026-10-20T00:00:00.000Z",
  "rooms": [{
    "id": "101",
    "number": "101",
    "floor": 1,
    "typeId": "67f4568c-89ab-4c12-b321-123456789012",
    "type": "Deluxe",
    "status": "VACANT",
    "label": "Vacant",
    "updatedAt": "2026-10-20T00:00:00.123456+00:00",
    "version": 1792454400123456
  }]
}
```

The supplied schema's primary key is `room_number`, not a separate UUID. `id`
therefore preserves that exact string; FDS must treat it as immutable. Do not
parse it as an integer, strip leading zeros or rename it. A renumbering policy
requires an agreed identity migration, not a fabricated MAD-only identifier.

Mappings: OCCUPIED = Occupied; VACANT = Vacant; UNDER_MAINTENANCE = Under
Maintenance; REQUIRES_CLEANING = Requires Cleaning. No status is inferred from
bookings, worker tasks or cached occupancy. Type ID/name come from room_types.
Unknown state, missing type, malformed timestamp/version or denied/missing source
returns sanitized 503. A genuinely empty source returns `rooms: []`. Responses
are no-store. No guest, booking, pricing, amenity or room-note data is returned.

## FDS producer contract

Use the existing durable `hotel.events` topic exchange and routing key
`room.status.changed`. MAD's independent durable queue is `mad.rooms`, with
invalid messages sent to `mad.rooms.dead`. Messages are acknowledged only after
durable MAD persistence. The existing kitchen queue and contract are unchanged.

```json
{
  "eventId": "77f4568c-89ab-4c12-b321-123456789012",
  "type": "room.status.changed",
  "roomId": "101",
  "version": 1792454400123456,
  "occurredAt": "2026-10-20T00:00:00.123456Z"
}
```

FDS must update its room and write its outbox in one transaction, then publish
after commit with persistent delivery and publisher confirms. Reuse the event ID
on publication retry. Version is `(extract(epoch FROM rooms.updated_at)*1000000)::bigint`.
Keep the exact PostgreSQL microseconds; JS Date loses sub-millisecond precision.
Every update must advance updated_at strictly, for example using
`greatest(clock_timestamp(), updated_at + interval '1 microsecond')`.
Room-type changes must bump the affected room versions and publish their events.
FDS physical room deletion/renumbering is not a supported status event.

MAD ignores any producer-supplied room payload and reads the committed source.
If the row is absent, unavailable or behind the event version, the delivery is
left unacknowledged and retried. A stale event may reconcile a newer committed
source version; the emitted envelope version always equals `room.version`.
`occurredAt` remains the triggering event's timestamp; `room.updatedAt` identifies
the authoritative state. Per-room version records and event UUIDs survive restart.
Duplicate/equal/older reconciled versions do not replace the latest accepted state.
Advancing a version supersedes older pending dispatch rows.

Authorized clients receive Socket.IO `room.status.changed` with the validated
envelope plus `room` containing the full authoritative snapshot row. Clients must
apply only greater per-room versions and reload `/mad/rooms/status` on reconnect.
The separate `rooms.transport.status` message reports `{ healthy: boolean }`.
The existing kitchen `transport.status` remains independent. Transport health
does not establish that an external FDS producer is correctly publishing.

## Setup and operation

1. Review and manually apply `deploy/neon-mad-rooms.sql`. It adds only private MAD
   event/version tables and an index. Adapt the commented column-level source
   grants and private-table grants to the actual MAD runtime role.
2. Use existing `MAD_REALTIME_ENABLED=true` and `RABBITMQ_URL` configuration.
   No new environment variables or dependencies are required.
3. Have FDS implement/confirm the producer contract. That application is outside
   this repository; no FDS publisher or hosted database changes were performed here.
4. Use the existing one-use ticket endpoint and Socket.IO connection described in
   [the transport guide](KITCHEN_REALTIME_GUIDE.md). Origin, session revocation,
   expiry, role and password-change checks apply to room updates too.

No SQL executes at startup. Missing MAD event tables disable room transport
without returning fake room data or changing the kitchen channel. The snapshot
needs only source SELECT permissions; room events additionally need the private
tables. Retain pending rows and version watermarks; coordinate any dedup-log
retention with the FDS replay window. Diagnose dead letters before replaying.

The existing single-instance transport and local direct-socket/production upgrade
proxy constraints still apply. Tests in `test/rooms.e2e-spec.ts` use disposable
PostgreSQL and RabbitMQ `/mad_test`; unit cases are under `src/rooms` and
`src/realtime/room-consumer.spec.ts`. Tests are authored, not run locally.
CI coverage, real FDS staging integration and <=1-second propagation/<=2-second
UI target measurements remain pending. This API ticket does not change the UI.

DDP-028 uses the actual integer `rooms.floor` for grouping (including zero/negative floors), never room-number inference. Existing restricted roles need `GRANT SELECT(floor) ON rooms TO mad_runtime` after replacing the role name. This does not require a source schema change.
