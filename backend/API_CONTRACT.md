# MAD API and event reference — DDP-037

Source review: 2026-10-21. These are implemented contracts, not a claim of
cross-service acceptance. MAD is the subsystem name; DDP is the ticket prefix.
No OpenAPI endpoint or generated Swagger UI is currently provided.
Ownership, undecided interfaces and proposed policy resolutions are recorded in
the [DDP-038 pack](contracts/DDP_038_CONTRACT_PACK.md); proposals are not new
implemented permissions or provider-approved wire contracts.
The [method/path inventory](contracts/endpoint-inventory.csv) enumerates every
current REST controller route, including public health aliases and denied task
mutations. It was extracted statically without starting the application.

## Addressing, authentication and errors

| Caller             | REST address                                 | Authentication                                          |
| ------------------ | -------------------------------------------- | ------------------------------------------------------- |
| Direct integration | `http://localhost:4000/auth/*`, `/mad/*`     | Bearer JWT except login/health                          |
| Local gateway      | `http://localhost:8080/mad/auth/*`, `/mad/*` | Same JWT; gateway rewrites `/mad/auth` to `/auth`       |
| Dashboard browser  | Same-origin `/api/*` BFF                     | HttpOnly `mad_session`; BFF forwards bearer server-side |

The separate gateway routes APIs; each subsystem owns its login. MAD only logs
in managers. Do not send staff to MAD login or place JWTs in localStorage.
Browser writes require the configured APP_ORIGIN; CRUD/auth handlers require
JSON and reject cross-site requests. Socket tickets use the same-origin BFF.
Backend JWTs use HS256, issuer JWT_ISSUER, audience `mad` and eight-hour lifetime.
Every protected request checks current account activation, role, session version,
revocation and first-login password-change state. Managers have hotel-wide access;
there is no per-manager tenant boundary.

JSON fields are case-sensitive. DTOs reject unrecognized fields. Numeric bodies
use numbers, not numeric strings. Date-only values are real `YYYY-MM-DD` dates;
timestamps use ISO8601 with explicit offset/Z. Counts/versions are safe integers.
JSON success responses are objects, not wrapped in a generic `data` field.
Paginated resources return `{items,total,page,pageSize}` unless listed otherwise.
Successful GET/PATCH/PUT/DELETE are 200; POST defaults to 201 except auth,
staff reset and promotion activate/deactivate, which explicitly return 200.

Backend errors use `{code:string,message:string,details?:string[]}`. Validation details
are optional and only attached for 400 validation arrays. Missing/invalid/expired
sessions: 401 `UNAUTHENTICATED`; valid disallowed role: 403 `FORBIDDEN`;
first-login dashboard access: 403 `PASSWORD_CHANGE_REQUIRED`; invalid inputs:
400 `VALIDATION_ERROR`; missing target: 404 `NOT_FOUND`; stale/duplicate/conflicting
state: 409 `CONFLICT`; oversized request: 413 `PAYLOAD_TOO_LARGE`; export bounds:
422 `REPORT_TOO_LARGE`; rate limiting: 429 `RATE_LIMITED`; dependency failure:
503 `SERVICE_UNAVAILABLE`; unexpected failure: 500 `INTERNAL_ERROR`.
Feature-specific codes can refine client errors. Server errors redact custom
codes/messages/details. Do not display upstream raw driver/provider responses.
The BFF sanitizes errors and may map backend 429 to 503; it is not a transparent
copy of every backend status. Responses are no-store.
Some BFF failures return only `{code}`; clients must not require a message from
every browser endpoint. Unsupported routes/methods can use framework-generated
404/405 responses rather than this backend filter envelope.

## Authentication and health

| Method/path (direct)                     | Request                                              | Response                                            |
| ---------------------------------------- | ---------------------------------------------------- | --------------------------------------------------- |
| POST `/auth/login`                       | `{username:string(1..100),password:string(1..1024)}` | `{accessToken,...Session}`                          |
| GET `/auth/session`                      | Bearer, no body                                      | `Session`, including first-login state              |
| POST `/auth/change-password`             | Bearer; `{currentPassword,newPassword}`              | `{accessToken,...Session}` with new session version |
| POST `/auth/logout`                      | Bearer, no body                                      | `{status:"signed_out"}`; durable token revocation   |
| GET `/health/live`, `/mad/health/live`   | Public                                               | `{status:"ok",service:"mad-backend"}`               |
| GET `/health/ready`, `/mad/health/ready` | Public                                               | Above plus `database:"ready"`, or safe 503          |

`Session={sub:UUID,username:string,role:"MANAGER",expiresAt:epochSeconds,
passwordChangeRequired:boolean}`. Password change requires a different 12..1024
character non-whitespace password. It clears the flag and invalidates old sessions.
Five failed attempts lock a known account for 15 minutes. Login username is
trimmed/lowercased. Expiry requires a new login; there is no refresh-token endpoint.
BFF login/change-password return only Session and set the HttpOnly cookie, never
the accessToken. BFF POST bodies, including logout, must be JSON (`{}` for logout).
Cookie is SameSite=Strict, host-only, path `/`, and Secure when APP_ORIGIN is HTTPS.

Browser BFF inventory (same frontend origin):

| Route                                                                         | Methods / backend mapping                                                         |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `/api/auth/session`, `/api/auth/{login,logout,change-password}`               | GET session, POST actions; `/auth/*` through configured direct/gateway mode       |
| `/api/health`                                                                 | GET public readiness                                                              |
| `/api/analytics`                                                              | GET period; backend overview                                                      |
| `/api/analytics/occupancy`                                                    | GET month YYYY-MM; converts to that month's inclusive from/to                     |
| `/api/analytics/operations/{food-orders,service-requests,worker-performance}` | GET period, workerId only for worker performance                                  |
| `/api/staff` and `/:id`, `/:id/reset-password`                                | GET/POST collection, GET/PATCH detail, POST reset; browser reset requires version |
| `/api/promotions` and `/:id`, `/room-types`, `/:id/{activate,deactivate}`     | GET/POST collection, GET/PUT/DELETE detail, GET room types, POST actions          |
| `/api/complaints` and `/:id`                                                  | GET collection/detail, PATCH detail                                               |
| `/api/rooms/status`, `/api/kitchen/orders`, `/api/tasks`                      | GET corresponding protected snapshot                                              |
| `/api/reports/:type`                                                          | GET validated binary download                                                     |
| `/api/realtime/ticket`, `/api/kitchen/ticket`                                 | POST one-use socket ticket aliases                                                |

There is no BFF low-booking-alerts route, alert-list API, task-limit API, or staff
login API in the current checkout. Unsupported BFF methods have no route handler.

Readiness checks auth prerequisites, not every analytical view, event queue or
external integration. A healthy status does not certify the complete application.

## Analytics

All paths start `/mad/analytics/`, require a manager with completed password
change, and return 200 JSON. `period=day|week|month` defaults to day. Unknown,
invalid or repeated filters are rejected by the corresponding validation path.
No arbitrary historical period/asOf request parameter is exposed.

`Window={period,timezone:"Asia/Colombo",start:timestamp,end:timestamp,asOf:timestamp}`.
Period start is inclusive and end exclusive; weeks start Monday. `Freshness` is
`{queriedAt:timestamp,sourceLatestUpdatedAt:timestamp|null}`. Zero is valid data;
a dependency outage returns 503. Nullable averages/rates mean unavailable, not zero.

| GET suffix           | Query                                  | Response schema                                                                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----- |
| `bookings`           | period                                 | Window + `weekStartsOn:"monday",metric:"bookings_checking_in",includedStatuses:string[],bucketSize:"day",total:int,trend:[{date,start,end,count}],freshness`                                                                                                                       |
| `revenue`            | period                                 | Window + `currency:"LKR",metric:"completed_payment_revenue",comparison:"whole_calendar_period",previousStart,previousEnd,currentMinor:int,previousMinor:int,percentageChange:number                                                                                                | null,percentageUnavailableReason:"PREVIOUS_REVENUE_ZERO" | null` |
| `overview`           | period                                 | `{bookings:BookingSummary,revenue:RevenueSummary}` with shared window/asOf                                                                                                                                                                                                         |
| `occupancy`          | required from/to, inclusive <=366 days | `{from,to,timezone,rangeEndInclusive:true,maxRangeDays:366,includedStatuses,denominator:"active_rooms_excluding_maintenance",dates:[{date,occupiedRooms:int,eligibleRooms:int,rate:number                                                                                          | null}],freshness}`                                       |
| `low-booking-alerts` | none                                   | `{from,to,timezone,rangeEndInclusive:true,threshold,denominator,includedStatuses,alerts:[OccupancyDay+{promotionSuggestion:string}],unavailableDates:[OccupancyDay+{reason:"ZERO_ELIGIBLE_ROOMS"}],freshness}`                                                                     |
| `food-orders`        | period                                 | Window + `weekStartsOn,metric:"non_cancelled_food_orders_placed",includedStatuses,total,trend:[{date,count}],hours:[{hour:0..23,count}],peakHours:int[],popularItems:[{menuItemId:UUID,name,quantity:int}],itemLimit:10,itemGrouping:"menu_item_id_and_historical_name",freshness` |
| `service-requests`   | period                                 | Window + `weekStartsOn,total,createdCohort,trend:[{date,count}],byStatus:[{status,count}],resolution,backlog,dataQuality,freshness`                                                                                                                                                |
| `worker-performance` | period, optional workerId UUID         | Window + `weekStartsOn,workerScope,completionCohort,durationStart:"submitted_at",durationUnit:"minutes",complaintCohort,openComplaintStatuses,dataQualityScope,workers:Worker[],freshness`                                                                                         |

Metric policies:

- Bookings count by **check-in date**, statuses CONFIRMED/CHECKED_IN/CHECKED_OUT.
  Occupancy counts occupied nights with exclusive checkout and active-room/
  maintenance history; no history is inferred from today's room state. Rate is
  occupied/eligible, null for zero eligible. Room history must be supplied manually.
- Revenue sums COMPLETED payments by paid_at in LKR integer cents. Excludes
  PENDING/FAILED/REFUNDED; it is not net revenue accounting by refund event date.
  Compare whole calendar periods, not elapsed portions. Previous zero yields
  null percentage/reason; otherwise `(current-previous)/previous*100`.
- Low-booking alerts cover today plus the next 13 hotel dates. Rate strictly
  below LOW_BOOKING_THRESHOLD (default .40) alerts; null rates are unavailable.
- Food includes PLACED/IN_PREPARATION/READY/DELIVERED by placed_at. Peak hours
  include ties; zero orders gives no peak. Top ten items aggregate quantities by
  item ID and historical name; trend/hour counts count orders, not item quantities.
- Service totals/status/trend use submitted_at in period. Resolution uses current
  COMPLETED records with completed_at in period; duration starts submitted_at.
  Backlog is currently unresolved SUBMITTED/ASSIGNED/IN_PROGRESS across all dates
  submitted by asOf. `resolution={cohort,unit:"minutes",completedCount,
validDurationCount,excludedCount,averageMinutes:number|null}`;
  `backlog={cohort,statuses,count}`. Invalid durations are excluded and exposed in
  `dataQuality={scope,status:"OK"|"WARNING",negativeDurationCount,
missingCompletionCount,unexpectedCompletionCount}`.
- Workers include current WORKER roles or historical assignees, including inactive
  workers. Tasks and complaints aggregate independently. Worker is `{workerId,
fullName,role,isActive,completedTaskCount,validDurationCount,
excludedDurationCount,averageCompletionMinutes:number|null,openComplaintCount,
dataQuality:{status,negativeDurationCount,missingCompletionCount,
unexpectedCompletionCount}}`. Completions use completed_at in period; complaints
  are currently open across dates. A worker with no completions has null average.

Exact source policies/projections are in [analytics services](src/analytics).
Frontend validators in [analytics.ts](../frontend/lib/analytics.ts),
[operations-analytics.ts](../frontend/lib/operations-analytics.ts) and
[occupancy.ts](../frontend/lib/occupancy.ts) intentionally select browser fields;
they do not enumerate every additional backend metadata field.

## Staff

Roles: RECEPTIONIST, WORKER, KITCHEN_STAFF, KITCHEN_MANAGER. Manager accounts
cannot be targets. All `/mad/staff` routes require manager dashboard access.

| Method/path                          | Input                                                                                               | Response                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| GET `/mad/staff`                     | search <=100 chars; role; status active/inactive; page 1..100000 default1; pageSize1..100 default20 | Page of StaffProfile including deliveryStatus       |
| GET `/mad/staff/:id`                 | UUID                                                                                                | StaffProfile including deliveryStatus               |
| POST `/mad/staff`                    | CreateStaff                                                                                         | 201 `{staffId,deliveryId,deliveryStatus:"pending"}` |
| PATCH `/mad/staff/:id`               | version + >=1 mutable field                                                                         | StaffProfile with incremented version               |
| POST `/mad/staff/:id/reset-password` | `{version:int}` recommended; backend permits omitted version for legacy callers                     | 200 `{staffId,deliveryId,deliveryStatus:"pending"}` |

CreateStaff has required `name` 1..255 and `vocation` 1..100 (trimmed, no control
characters or angle brackets), email 3..320 (trim/lowercase, valid email), age
integer1..120, phone optional leading `+` then7..15 digits, NIC nine digits plus
V/X or12 digits (uppercase), and role. PATCH accepts these fields plus
`isActive:false`; activation, username/password replacement and manager elevation
are not allowed. PATCH version is integer0..2147483646. Reset version has the same
range when supplied; the dashboard BFF requires it. See
[DTOs](src/staff/create-staff.dto.ts) and [update validation](src/staff/update-staff.dto.ts).

StaffProfile fields: `{staffId,name,vocation,email,age,phone,nic,username,role,
isActive,passwordChangeRequired,version}`; optional legacy source age/phone/NIC
can be null. Directory/detail add `deliveryStatus` pending/failed/sent/cancelled/
none. Search is literal name/email/username matching, not wildcard SQL. Profile
mutations use session_version as optimistic version; edits/reset invalidate old
staff sessions. Reset is not idempotent; reconcile after a timeout before retrying.
Inactive reset and stale edits return 409; manager/missing targets404.

Generated staff passwords are bcrypt cost12; manager passwords use scrypt. Each
owning subsystem must support its account hash format, activation/version checks
and first-password change. MAD never implements another subsystem's login. Email
credentials are AES-256-GCM encrypted in the delivery queue; passwords/hashes/
ciphertext are never in these API responses. Queued/sent is not proof of login.

## Promotions and complaints

Promotion page defaults1/20, maxpage1000000/pageSize100. GET/POST
`/mad/promotions`, GET `/mad/promotions/room-types`, GET/PUT/DELETE
`/mad/promotions/:id`, POST `/mad/promotions/:id/activate` and `/deactivate`.
All require manager access. POST create201, other successful actions200.

Create requires `{code,discountType,discountValue,validFrom,validUntil,roomTypeIds,
maxRedemptions,status?}`. Code trims/ASCII uppercases, length1..50, starts
alphanumeric, remaining characters `[A-Z0-9_-]`. Type PERCENTAGE or FIXED_AMOUNT;
value positive integer <=2147483647, percentage<=100, fixed value LKR cents.
One to100 unique room-type UUIDs; positive maxRedemptions<=2147483647.
Validity uses explicit-offset timestamps with seconds and at most millisecond
fractions; inclusive start/exclusive end, end strictly after start.
Create status optional ACTIVE/INACTIVE (service defaults ACTIVE). PUT replaces
all editable create fields plus version, but cannot set status. Activate,
deactivate and DELETE take JSON `{version}`. Never automatically retry a stale
write using a newly fetched version. Deletion is logical and irreversible.

Promotion response adds `{id,version,deletedAt:timestamp|null,currency:"LKR",
currentRedemptions,status,lifecycleState,publicationStatus,createdAt,updatedAt}`
to editable fields. Lifecycle ACTIVE/INACTIVE/SCHEDULED/EXPIRED/EXHAUSTED/DELETED;
publication PENDING/FAILED/NO_PENDING_WORK is outbox state, not website acceptance.
Room-type page items are `{id,name,priceMinor,maxGuests}`. Code uniqueness and
versions can produce409; missing room types/invalid terms400; missing ID404.
Canonical [DTO](src/promotions/promotion.dto.ts),
[response/lifecycle/outbox mapping](src/promotions/promotions.service.ts),
[browser schemas](../frontend/lib/promotions.ts).

Complaints: GET `/mad/complaints` accepts optional status SUBMITTED/UNDER_REVIEW/
RESOLVED, trimmed category1..100, workerId UUID, page1..1000000 default1,
pageSize1..100 default20. GET `/mad/complaints/:id` returns detail. PATCH takes
`{version:0..2147483646,status:"UNDER_REVIEW"|"RESOLVED",note:string}`; note
trimmed1..4000, controls prohibited except tab/CR/LF. All manager-only, success200.
Only SUBMITTED -> UNDER_REVIEW -> RESOLVED, no reopening or repeated transitions.

Complaint is `{id,category,description,referencedWorkerId:UUID|null,submittedAt,
status,resolvedAt:timestamp|null,version}`. List is a Page; detail adds
`history:[{version,fromStatus,status,note,actorId,recordedAt}]`. PATCH returns the
updated base complaint, not detail/history. Invalid transition400, stale409,
missing404. FOSS owns source; MAD is authorized to change only status/resolved_at.
Notes/history/outbox are MAD-private. [DTO](src/complaints/complaint.dto.ts),
[response schemas](../frontend/lib/complaints.ts).

## Operational snapshots and exports

| GET path              | Query                                                                                                                              | Response / complete schema reference                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `/mad/rooms/status`   | none                                                                                                                               | `{rooms:[{id,number,floor,typeId,type,status,label,updatedAt,version}],queriedAt,source:"FDS",readOnly:true}`; [room contract](ROOM_STATUS_GUIDE.md)                                                                      |
| `/mad/kitchen/orders` | optional status PLACED/IN_PREPARATION/READY/DELIVERED; page1..100000 default1, pageSize1..100 default20                            | `{orders:[{id,roomNumber,mealPeriod,status,placedAt,updatedAt,version,itemCount}],counts:{PLACED,IN_PREPARATION,READY,DELIVERED},total,asOf,deliveredSince,page,pageSize}`; [kitchen contract](KITCHEN_REALTIME_GUIDE.md) |
| `/mad/tasks`          | optional status UNASSIGNED/ASSIGNED/IN_PROGRESS/COMPLETED/ESCALATED; worker UUID; page1..100000 default1, pageSize1..100 default20 | `{tasks:[{id,roomNumber,category,priority,status,assignee:{id,name}                                                                                                                                                       | null,submittedAt,updatedAt,completedAt:timestamp | null,version}],total,queriedAt,page,pageSize,source:"WKMS",readOnly:true}`; [task contract](OPERATIONS_GUIDE.md) |
| `/mad/reports/:type`  | required format csv/pdf and report-specific filters                                                                                | Binary CSV/PDF attachment; [export contract](REPORT_EXPORT_GUIDE.md)                                                                                                                                                      |

Room identity is the immutable room-number string (<=10), not UUID. Floors are
actual integers. Room states VACANT/OCCUPIED/REQUIRES_CLEANING/UNDER_MAINTENANCE.
Kitchen counts span all statuses regardless of page/filter; delivered retention
is today's hotel midnight through snapshot time, open orders have no age cutoff,
CANCELLED is excluded. Task category ROOM_CLEANING/EXTRA_TOWELS/WATER_BOTTLES/
MAINTENANCE/LAUNDRY/FOOD_DELIVERY/OTHER; priority HIGH/NORMAL. Completed tasks have
completedAt, other statuses null. ALL methods on `/mad/tasks/:id/{claim,assign,
complete}` reject authorized managers with403; no room/kitchen/task mutation API.
Task pagination uses decimal digits only. Task snapshots validate unique IDs,
filter/page consistency and exact updated_at microsecond revisions, and project
only documented public fields. Inconsistent source data returns sanitized503.

Report types: bookings, revenue, worker-performance, staff (worker-performance
alias, **not staff credentials**), food-orders, service-requests, occupancy,
low-booking-alerts. All except occupancy/low alerts accept period; staff/worker
also workerId. Occupancy requires from/to inclusive<=366days. Low alerts accepts
only format. No arbitrary filter combinations/repeated values. CSV is UTF-8 BOM,
CRLF, quoted Field/Value/Unit rows with formula protection. PDF has embedded
fonts. Output max8MiB/10000rows/120pages; max200workers, cell2048bytes and two
concurrent exports per instance. Bounds422, unavailable503. Response headers
include Content-Type, Content-Disposition attachment, length, no-store/nosniff.
Frontend [download contract](../frontend/REPORT_DOWNLOAD_GUIDE.md) validates MIME,
filename, bounds and signature. Pagination in UI does not restrict the export
cohort. Missing data is not an invented zero-valued report.

## Events and WebSocket transport

See [DDP-039 transport reliability](REALTIME_GUIDE.md) for immutable kitchen event
identities, superseded invalidations, exact ticket expiry, reconnect and auth-race
behavior. Permanent kitchen ID conflicts are dead-lettered, not acknowledged as
duplicates. No schema or public event shape changed.

Producer contracts use durable topic `hotel.events`, persistent messages and
publisher confirms after the source transaction/outbox commits. Envelope max8192
bytes: `{eventId:UUID,type:string,<entityId>,version:safeInt>=0,occurredAt:ISOoffset}`.
`version` is an **entity revision**, not a schema-version field. Wire envelopes
currently have no schemaVersion; do not invent `v1` headers or silently break
consumers. Breaking changes need an agreed new contract/routing policy (DDP-038).

| Source routing key/type | Extra fields                                                                      | MAD inbox queue / dead-letter queue | Socket event                                            |
| ----------------------- | --------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `kitchen.order.changed` | orderId UUID                                                                      | mad.kitchen / mad.kitchen.dead      | kitchen.order.changed                                   |
| `room.status.changed`   | roomId string1..10                                                                | mad.rooms / mad.rooms.dead          | room.status.changed, with authoritative room projection |
| `task.changed`          | taskId UUID                                                                       | mad.tasks / mad.tasks.dead          | task.changed, with authoritative task projection        |
| `kitchen.stock.changed` | menuItemId UUID, stockStatus AVAILABLE/LOW_STOCK/UNAVAILABLE/TEMPORARILY_DISABLED | mad.stock / mad.stock.dead          | stock.alert.changed, with authoritative alert           |

Verify queue names/retry behavior in the linked feature guides before producer
rollout. Versions use exact PostgreSQL updated_at epoch microseconds; do not
derive them from a JS Date after discarding precision. Duplicate/stale versions
do not create new state. MAD reads authoritative source columns and persists
inbox/outbox before ACK. Stock uses quorum queues, bounded retries (five redeliveries)
and at-least-once DLX; do not claim the other consumers have this same retry bound.
Malformed messages are dead-lettered. Queue-type changes require a reviewed
migration/drain, not purging production messages. External producer adoption is
still pending actual owning-team confirmation/staging evidence.

POST `/mad/realtime/ticket` accepts a manager bearer, returns201
`{ticket:string,expiresIn:30}`. Browser POST `/api/realtime/ticket` (also kitchen
alias) uses its cookie/Origin and returns200 `{ticket,socketUrl}` (no expiresIn).
Connect Socket.IO using
`path:"/mad/socket.io",transports:["websocket"],auth:{ticket}`. Tickets are
single-use, valid30seconds, instance-local, max1000 outstanding. Exact frontend
Origin is required; failed handshakes report UNAUTHENTICATED. Connections recheck
current manager authorization on sends/5second heartbeats and disconnect revoked
sessions. Status events `transport.status`, `rooms.transport.status`,
`tasks.transport.status`, `stock.transport.status` carry `{healthy:boolean}`.
Reconnect needs a fresh ticket; REST snapshots reconcile after outages. Run one
MAD instance until shared tickets and fanout exist. Local REST gateway has no
WebSocket upgrade support: sockets use the backend or an upgrade-capable proxy.

Stock socket envelope is `{eventId,type:"stock.alert.changed",menuItemId,version,
occurredAt,alert:{alertId,menuItemId,name,stockStatus,active,version,
sourceUpdatedAt,raisedAt:timestamp|null,clearedAt:timestamp|null}}`. AVAILABLE
clears, other states activate. No alert-list/unread API exists yet (DDP-043).
See [stock guide](STOCK_EVENTS_GUIDE.md) and [exact types](src/stock/stock-event.ts).

Promotion transactions currently write private outbox rows with event_type
`promotion.upsert`/`promotion.deleted`, event_id, promo_id, promotion_version and
payload equal to Promotion. DDP-040 now adds opt-in confirmed broker publication
with envelope `{eventId,type,promotionId,version,occurredAt,promotion}`; the HW
consumer/checkout and application acknowledgement remain external/pending. See
[publication and HW contract](PROMOTION_SYNC_GUIDE.md). Complaint outbox payload is `{type:"complaint.status_changed",
complaintId,version,previousStatus,status,referencedWorkerId,occurredAt}`; event_id
is a separate column, **not inside this payload**. No note is published. Its
downstream notifications integration remains pending. Neither outbox persistence
is a claim of successful external delivery.

## Safe integration examples

Use PowerShell variables populated privately; do not paste credentials or bearer
responses into logs, tickets or source. Commands below target direct MAD.

```powershell
$madBase = 'http://localhost:4000'
# $madUsername, $madPassword and $madToken must come from your private session.
$loginBody = @{ username = $madUsername; password = $madPassword } | ConvertTo-Json
$madLogin = Invoke-RestMethod "$madBase/auth/login" -Method Post -ContentType 'application/json' -Body $loginBody
$madToken = $madLogin.accessToken
$madHeaders = @{ Authorization = "Bearer $madToken" }
# Complete password change first if passwordChangeRequired is true.
Invoke-RestMethod "$madBase/mad/analytics/bookings?period=week" -Headers $madHeaders
Invoke-RestMethod "$madBase/mad/staff?page=1&pageSize=20&role=WORKER" -Headers $madHeaders
```

Example complaint PATCH after reading version0:

```json
{
  "version": 0,
  "status": "UNDER_REVIEW",
  "note": "Assigned for investigation."
}
```

Example promotion draft (replace roomTypeIds with an existing test room type):

```json
{
  "code": "WEEKDAY10",
  "discountType": "PERCENTAGE",
  "discountValue": 10,
  "validFrom": "2026-11-01T00:00:00+05:30",
  "validUntil": "2026-12-01T00:00:00+05:30",
  "roomTypeIds": ["67f4568c-89ab-4c12-b321-123456789012"],
  "maxRedemptions": 100,
  "status": "INACTIVE"
}
```

Examples are illustrative fixtures, not executed evidence. Keep browser code on
the BFF; direct bearer examples are for trusted integration tooling only.

## Persistent notifications - DDP-043

GET `/mad/notifications?page=1&pageSize=20` returns a manager-specific active-issue
snapshot: items, global total/unread, complaint/stock counts, page/pageSize/queriedAt.
PATCH `/mad/notifications/:type/:id/read` accepts only a current revision, with no
query fields. Type is COMPLAINT/STOCK; ID UUID. Marking read does not change active
counts or resolve source issues. Missing/invalid session401, disallowed403,
invalid400, inactive/missing404, stale409, unavailable503. Responses are no-store.

The BFF exposes `/api/notifications` and its read path, with server-held cookie
sessions and same-origin JSON mutations. Shared state supplies the panel, dashboard
alert area and navigation badge. Authenticated `notifications.changed` invalidates
snapshots; `notifications.transport.status` reports source reconciliation health.
See [exact fields, examples/policies, SQL and register](NOTIFICATIONS_GUIDE.md).

## Staff directory completion - DDP-044

GET `/mad/staff` retains its search/role/status filters and safe directory response.
Pagination is decimal digits only. GET `/mad/staff/:id` accepts no query fields;
unknown/manager IDs404, invalid input400, missing/invalid session401, disallowed403,
invalid/unavailable source503. Stable sorting, matching totals, unique UUIDs,
profile allowlists and current delivery state are validated before returning data.
The BFF additionally verifies requested IDs, filters and page/pageSize. Response
fields and UI remain unchanged. See [staff contract and register](STAFF_UI_GUIDE.md).
