# Persistent notifications - DDP-043

The Notifications panel, top-of-dashboard alert area and sidebar badge share one
current-alert snapshot. Existing styling is retained. No hosted SQL or tests ran.

## Deployment

Review and manually apply `deploy/neon-mad-notifications.sql` after the auth and
complaint supplements. Adapt its commented grants for the dedicated MAD runtime
role. It adds only `mad_notification_reads`, with manager/type/entity primary key;
it changes no FOSS/KMS source rows. Keep synchronization disabled. Missing tables
or grants produce sanitized503; startup never installs schema.

No new secrets, dependencies or environment variables are required. Existing REST
gateway routes and authenticated socket ticket/public URL configuration apply.
See [transport constraints](REALTIME_GUIDE.md): one MAD instance and an appropriate
HTTPS/WebSocket ingress for deployment. Never apply disposable test SQL to Neon.

## State policy

- COMPLAINT: source FOSS SUBMITTED/UNDER_REVIEW rows, keyed by complaint UUID.
  RESOLVED disappears. Only category/status/ID/submitted time are projected; no
  guest description, internal note, referenced worker or credential is included.
- STOCK: source KMS menu rows in LOW_STOCK/UNAVAILABLE/TEMPORARILY_DISABLED.
  AVAILABLE clears. Source-derived state covers pre-existing issues and repairs
  missed events; the DDP-034 durable stock inbox/history remains unchanged.
- Identity is type plus UUID; two types sharing a UUID are separate issues.
  Ordering is occurrence descending, then type/UUID. Counts span every page.
- Badge and `total` count **all active issues**, including read ones. `unread` is
  separate. Reading never resolves a complaint, replenishes stock or hides an issue.
- Receipts are per authenticated manager and current source revision: complaint
  status plus MAD state version, or exact stock updated_at epoch microseconds.
  Changed issues become unread again. Reads survive reload/restart and never affect
  another manager. Concurrent source changes cannot be acknowledged with an old
  revision; the atomic upsert either matches the source revision or returns409/404.
- Empty source is200/zero; unavailable, denied or malformed source is503. Transient
  failure retains the last snapshot/count with stale status and Retry. No initial
  snapshot means an unknown `?` badge. Authentication denial clears protected data.

## HTTP and browser contract

`GET /mad/notifications?page=1&pageSize=20`: manager after first-password change.
Decimal page1..100000, pageSize1..100 (default20); unknown/repeated filters400.
One SQL statement returns `{items,total,unread,counts:{complaints,stock},page,
pageSize,queriedAt}`. Each item contains `id` (type:UUID), `type` (COMPLAINT/STOCK),
`sourceId`, `title`, `status`, `occurredAt`, `revision`, `isRead`, `href`.

`PATCH /mad/notifications/:type/:id/read` accepts only
`{"revision":"SUBMITTED:0"}` (stock revision is a decimal microsecond string).
No query fields. Returns `{"read":true}`; repeated reads are idempotent with respect
to active counts. Stale revision409, inactive/missing404, invalid400, missing/invalid
session401, disallowed role or mandatory-password-change session403. Storage
errors503. Responses are sanitized/no-store. Receipt writes cannot modify issues.

The same paths under `/api/notifications` keep JWTs server-side, validate response
identities/counts/pagination and exact local links, and require same-origin JSON
for PATCH. Unknown fields and oversized read bodies are rejected. Complaint links
open the existing authorized detail panel. Stock links preserve page and anchor
to that alert's title/status/time/reference in Notifications.

## Live reconciliation and maintenance

One serialized backend poll compares a source fingerprint one second after its
preceding query finishes. Changed state emits `notifications.changed` with opaque
revision/occurredAt to authorized sockets; no private issue payload is pushed.
Read receipts also trigger invalidation. `notifications.transport.status` reports
polling health through existing socket heartbeats. This is source reconciliation,
independent of broker delivery; it needs no new external producer contract.

Clients reread authoritative snapshots on invalidation/reconnect, reconcile every
30seconds and retain the existing bounded retry/manual Retry behavior. No durable
browser acknowledgement or measured latency guarantee is claimed. DB timeouts
apply. Measure load/propagation on staging before NFR acceptance.

Monitor notification health separately from DB readiness. Repair missing source
grants/supplements manually. Receipts retain one row per manager/entity/type; no
destructive automatic cleanup runs. Coordinate retention with the schema owner.
Application rollback needs no FOSS/KMS data rollback; preserve receipts for reuse.

## Acceptance register

All cases: High priority, actual result/status **NOT_RUN**, CI/staging evidence and
defect links pending. Preconditions: disposable PostgreSQL, restricted MAD role,
seeded manager/worker/first-login sessions and authenticated local socket transport.
Source/test presence is not a pass or a claim of measured coverage.

| Case / requirement      | Type and candidate tests                                                                          | Input / expected result                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| TC-MAD-043-AC1 / MD-13  | API/DB `test/notifications.e2e-spec.ts`; frontend component `test/notifications.test.tsx`         | Complaint plus low stock: consistent panel/banner/badge counts, safe links, stable IDs/pages and no private-note disclosure               |
| TC-MAD-043-AC2 / MD-13  | API/DB and component suites above                                                                 | Repeated read preserves active counts/source rows; manager isolation and stale revision checked; resolution/recovery removes active issue |
| TC-MAD-043-AC3 / NFR-03 | API/DB/socket and component suites above                                                          | Missed/duplicate invalidations, persisted reads and reconnect reconcile; source errors retain last count or initial unknown               |
| TC-MAD-043-NEGATIVE     | API/DB suite; `src/common/security-boundaries.spec.ts`; frontend `test/notifications-bff.test.ts` | Validation, 401/403, CSRF, hostile links, stale reads, denied grants and corrupt source return safe errors without source writes          |
| TC-MAD-043-UNIT         | `src/notifications/notifications.spec.ts`                                                         | Projection, consistency, read receipts, fingerprint/dispatch failure, polling shutdown and DTO boundaries                                 |
| TC-MAD-043-DETAIL       | Frontend `test/complaints.test.tsx`                                                               | Notification deep link opens the specified existing complaint detail without a mutation                                                   |

Run the existing CI coverage/integration/browser jobs yourself. Notifications are
included in coverage; critical service branches90%, global lines/branches80%.
The Vitest integrity hash was deliberately updated solely for its reviewed new
notification BFF coverage path; every other protected config hash is unchanged.
Final CI/coverage, actual Neon grant confirmation and staging/latency evidence
remain release gates. SQL has been prepared, not applied.
