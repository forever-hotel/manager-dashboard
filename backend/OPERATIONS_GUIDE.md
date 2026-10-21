# Room board and read-only tasks — DDP-028 / DDP-042

The Rooms page reads FDS rooms; Tasks reads WKMS tasks. MAD cannot claim,
assign, complete, or edit these records. Task-limit configuration remains DDP-045.
The existing room card colors and layout are retained. Day/week/month controls
remain visible but disabled because the source provides current status only.
The Tasks placeholder is replaced with a queue using existing typography,
borders, spacing and colors.

## Manual deployment

1. Keep the existing auth and DDP-027 room supplements installed.
2. Review and manually apply `deploy/neon-mad-tasks.sql` to the shared database.
   It creates only MAD event inbox/version tables; it does not alter WKMS tables.
3. Use a restricted MAD role with SELECT on the listed WKMS columns and
   `staff_users(worker_id,full_name)`. It must not own WKMS tables or inherit
   INSERT/UPDATE/DELETE permissions on them. Keep existing auth-specific grants.
4. Add SELECT on `rooms.floor` if the role currently has column-level room grants.
   Replace `mad_runtime` in the commented grant examples with the actual role.
5. Rebuild/restart the application. Startup does not apply SQL or synchronize schema.
6. Keep `MAD_REALTIME_ENABLED=true`, `RABBITMQ_URL`, and the existing server-only
   frontend `MAD_SOCKET_PUBLIC_URL` configured. No new secrets are needed.

If the task supplement or broker is unavailable, authorized snapshots can still
work; the interface reports live updates unavailable and reconciles every 30 seconds.
Source query failures show unavailable/stale rather than invented task counts.

## HTTP contract

`GET /mad/tasks?status=IN_PROGRESS&worker=<UUID>&page=1&pageSize=20`

- Optional exact `status`: UNASSIGNED, ASSIGNED, IN_PROGRESS, COMPLETED, ESCALATED.
  Assigned is not treated as In Progress. Escalated remains visible.
- Optional exact assignee `worker` UUID. Omit it for all workers, including
  unassigned tasks. Clearing and applying the UI worker field removes the filter.
- Page defaults to 1, maximum 100000; pageSize defaults to 20, range 1–100.
- Unknown, repeated or invalid filters return 400.
- Pagination accepts decimal digit strings only, matching the BFF. Scientific,
  hexadecimal and fractional notation are rejected.
- Sort: submitted_at descending, task_id ascending, including completed history.
  No arbitrary day window or silent dropping of completed tasks.
- Response: `{tasks,total,queriedAt,page,pageSize,source:"WKMS",readOnly:true}`.
  Each task has `id`, `roomNumber`, `category`, `priority`, `status`,
  nullable `assignee:{id,name}`, `submittedAt`, `updatedAt`, nullable `completedAt`,
  and `version` (exact updated_at epoch microseconds).
- The page and total use one PostgreSQL statement snapshot. Empty results are 200;
  missing/denied/malformed source data returns sanitized 503.
- Snapshot validation rejects duplicate UUIDs, incomplete pages, mismatched status,
  worker or single-task lookups, invalid calendar/offset timestamps and revisions
  that differ from updated_at epoch microseconds. Labels must be nonblank and
  contain no control characters. Public fields are explicitly projected, including
  the assignee, so unrelated source properties cannot leak into REST or events.
- Missing/invalid sessions: 401; worker role or mandatory password change: 403.
  Claim/assign/complete paths `/mad/tasks/:id/{claim|assign|complete}` return 403
  for authenticated managers. No source write endpoint exists.
- The frontend BFF `/api/tasks` validates filters and response data, keeps the
  session token server-side, and returns no-store responses. Unsupported HTTP
  mutation methods have no handler.

`GET /mad/rooms/status` is described in `ROOM_STATUS_GUIDE.md`. DDP-028 adds the
actual integer `floor` to each room. Floors are never inferred from room numbers.
The frontend BFF `/api/rooms/status` accepts no query parameters.

## WKMS event producer contract

WKMS remains the state owner. Its developer must implement/confirm this contract:

1. Commit a task change and transactional outbox entry together. Advance
   `updated_at` strictly on creation, claim, progress, completion, reassignment
   and any other displayed task change.
2. Publish persistently with publisher confirms to durable topic exchange
   `hotel.events`, routing key `task.changed`:

```json
{
  "eventId": "67f4568c-89ab-4c12-b321-123456789012",
  "type": "task.changed",
  "taskId": "77f4568c-89ab-4c12-b321-123456789012",
  "version": 1792454400123456,
  "occurredAt": "2026-10-20T00:00:00.123456Z"
}
```

Use exact PostgreSQL epoch microseconds for `version`, not JavaScript milliseconds
multiplied after losing precision. Envelopes are at most 8192 bytes. Task IDs
remain stable UUIDs. This contract does not define task deletion; do not publish
a deletion as a normal change to a missing row.

MAD binds durable `mad.tasks` with dead-letter queue `mad.tasks.dead`. It validates
the envelope, rereads the committed source task, discards producer task payload,
serializes versions per task, and persists its inbox before acknowledging.
Duplicate/stale versions do not generate new current-state updates. Source
behind/unavailable events remain retryable; malformed envelopes are dead-lettered.
Pending socket delivery survives restart. Monitor inbox age and dead-letter depth;
repair invalid producer messages before replaying. Do not purge undelivered rows.

Socket clients use POST `/api/realtime/ticket`, which issues a one-use, 30-second
ticket through the existing protected backend. They listen on `/mad/socket.io`
for `task.changed` and `tasks.transport.status`; rooms use `room.status.changed`
and `rooms.transport.status`. Current manager sessions are rechecked on delivery.
Events invalidate snapshots: the UI never renders producer-provided task state.

Reconnect uses fresh tickets and bounded retries (five attempts, then manual Retry).
Reconnect, event updates and 30-second reconciliation retain status, worker and page.
Changing filters resets page to 1. Empty pages retain navigation so managers can
return after rows move between status groups. Auth failures clear protected data.

As with DDP-026/027, this transport supports one MAD instance. Multiple instances
need shared ticket storage and socket fan-out before deployment. Local sockets go
directly to backend port 4000; the separate gateway currently handles REST only.
Production needs an HTTPS/WebSocket-capable proxy with correct Origin configuration.

## Verification and remaining acceptance

Tests were authored, **not run locally** at the user's request:

- `src/tasks/tasks.spec.ts`: filters, mapping, failures, immutable owner boundary,
  event validation, deduplication, pending dispatch.
- `src/realtime/task-consumer.spec.ts`: durable broker lifecycle and failure paths.
- `test/tasks.e2e-spec.ts`: isolated real PostgreSQL, restricted role, snapshots,
  filters/paging, 401/403/400, denied mutation, persisted versions, actual RabbitMQ
  delivery to an authenticated socket. Uses TEST_DATABASE_URL and isolated
  TEST_RABBITMQ_URL `/mad_test`, never Neon.
- Frontend `test/rooms*.test.*` and `test/tasks*.test.*`: BFF contracts, room states,
  actual floors, filters/paging, reconnect, stale/retry and authorization behavior.
- Existing room integration coverage additionally checks floor and denied writes.

Run the existing CI unit/coverage and integration jobs. Coverage targets remain
80% globally and 90% branches for critical task snapshot logic. Passing coverage
and staging/provider behavior are not claimed without execution.

WKMS must separately deny manager mutation through its own API. MAD cannot enforce
another repository's owner endpoints; shared DB grants and MAD route guards protect
this application's boundary. Real WKMS producer delivery and owner authorization
require staging evidence before final cross-system acceptance.

### DDP-042 acceptance register

All entries are high priority. Preconditions are an isolated PostgreSQL database,
restricted MAD runtime role and seeded manager/worker/first-login sessions;
broker/socket cases additionally require the isolated RabbitMQ `mad_test` host.
Tests are authored, not executed locally. Actual results and evidence remain
pending CI and staging; no passing coverage or external owner adoption is claimed.

| ID / requirement | Type and test | Input and expected result |
| --- | --- | --- |
| TC-MAD-042-AC1 / MD-17 | API/DB: `test/tasks.e2e-spec.ts` | Five distinct states, status/worker filters and pages: stable IDs, assignee/category/priority/room/timestamps, exact microsecond versions and no duplicate page rows |
| TC-MAD-042-AC2 / MD-17, NFR-03 | API/DB/broker/socket: `test/tasks.e2e-spec.ts` | Committed source event publishes authoritative task; disconnect, complete source and reconnect: fresh GET returns completed state without requiring the missed event |
| TC-MAD-042-AC3 / MD-17 | API/DB: `test/tasks.e2e-spec.ts` | Invalid/repeated filters return 400; missing/invalid auth returns 401; worker/first-login/manager mutations return 403; restricted SQL UPDATE denied; source unchanged |
| TC-MAD-042-BOUNDARY / MD-17 | Unit: `src/tasks/tasks.spec.ts` | Empty/beyond-last pages remain valid; malformed/duplicate/incomplete or mismatched source, unsafe revisions and invalid dates return sanitized 503; extra source fields discarded |
| TC-MAD-042-RECOVERY / NFR-03 | Unit/component: `src/realtime/task-consumer.spec.ts`, frontend `test/tasks.test.tsx` | Persistent retry, duplicate/version handling, reconnect snapshot reload and authorization failure behavior |

No new SQL or environment variables are introduced by the DDP-042 completion.
Keep the existing manual task supplement and least-privilege grants above.
WKMS owner-side manager permissions, committed producer events and real staging
propagation remain external release gates, not implemented by MAD's route guard.
