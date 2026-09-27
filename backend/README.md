# Forever Hotel backend — DDP-001–009

NestJS API foundation with validated configuration, health/readiness, central
authentication, manager authorization and versioned PostgreSQL migrations.
Booking totals and trends are implemented by DDP-009. Staff provisioning,
occupancy and revenue analytics remain later-ticket work.

Use Node 22.14.x (see `../.nvmrc`) and npm 10 or later. From this directory:

```powershell
Copy-Item .env.example .env
npm ci
npm run build
npm run migration:run
npm run start:dev
```

First provision the database and restricted `mad_app` role using the
[local development guide](../local_development_guide.md). Set the central Auth
provider URL, issuer and shared signing key before signing in. There are no local
manager credentials or production authentication stubs.

| Command                               | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `npm run build`                       | Compile application TypeScript                           |
| `npm run start:dev`                   | Start with file watching                                 |
| `npm run start:prod`                  | Start the compiled API                                   |
| `npm run migration:run`               | Apply missing migrations with separate owner credentials |
| `npm run lint`                        | Read-only lint; warnings fail                            |
| `npm run format:check`                | Read-only formatting check                               |
| `npm run format` / `npm run lint:fix` | Explicit formatting/lint edits                           |
| `npm run test:cov`                    | Unit coverage with enforced thresholds                   |
| `npm run test:integration`            | Disposable PostgreSQL integration suite                  |

The integration suite requires `TEST_DATABASE_URL` pointing to a disposable test
database and an account allowed to create/drop test databases and test roles.
It does not use `DATABASE_URL`. `test:serve` is a test-only browser fixture.

`GET /health/live` reports process liveness; `GET /health/ready` requires access
to the migrated database. Database loss prevents readiness. Protected requests
fail closed when authentication or database checks cannot complete.

The central Auth provider must support login, session validation, logout and
password change. Confirm its contract and token-invalidation behavior before
integration. Database migrations use separate owner credentials, preserve existing
supported records and restrict the runtime role to its permitted tables. Failed
migrations roll back; committed schema changes require a reviewed forward migration
or backup recovery.

## DDP-009: booking totals and trends

`GET /mad/analytics/bookings?period=day|week|month` requires an active MANAGER
bearer session with first-password-change complete. Omitted `period` defaults to
`day`; invalid, repeated or unknown query parameters return `400 VALIDATION_ERROR`.
Missing/invalid sessions return `401 UNAUTHENTICATED`; other roles return
`403 FORBIDDEN`. The response is not cached.

The counting policy uses **check-in date**, as requested, with Asia/Colombo local
calendar boundaries and Monday-start weeks. A day has one daily bucket, a week
seven, and a month its actual number of dates, including leap days. Periods are
start-inclusive and end-exclusive. All scheduled check-ins within the current
period count, including dates later in the week/month. This is a count of bookings,
not room-nights, occupancy or revenue; multi-night bookings count once on check-in.

Current statuses CONFIRMED, CHECKED_IN and CHECKED_OUT are included; PENDING,
CANCELLED and unknown/null statuses are excluded. This inclusion rule and reporting
view contract remain subject to provider confirmation under DDP-038. Duplicate
booking IDs count once. The latest `updated_at` version wins before date filtering,
so cancellation or rescheduling cannot leave an older version counted. For a tied
update timestamp, an excluded status wins conservatively; otherwise status/date
sorting provides deterministic results. The provider must resolve conflicting
same-version dates and preserve stable booking IDs across replayed events.

The JSON response contains:

| Field                                | Meaning                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| `period`, `timezone`, `weekStartsOn` | Requested calendar policy                                                              |
| `metric`                             | `bookings_checking_in`                                                                 |
| `includedStatuses`                   | The status inclusion rule                                                              |
| `start`, `end`                       | UTC ISO timestamps for the hotel-local period, end exclusive                           |
| `asOf`                               | Request clock used to choose the current period; not historical version reconstruction |
| `bucketSize`                         | `day`                                                                                  |
| `total`                              | Sum of the trend counts                                                                |
| `trend`                              | Ordered `{date, start, end, count}` daily buckets, with zeroes for empty dates         |
| `freshness.queriedAt`                | PostgreSQL query timestamp for the snapshot read                                       |
| `freshness.sourceLatestUpdatedAt`    | Latest update visible anywhere in the reporting view, or null for an empty source      |

Source update time is not an ingestion watermark or proof of upstream delivery
freshness. A missing view, database failure or missing read permission returns
`503 SERVICE_UNAVAILABLE`, never a successful zero total. An available empty view
returns 200 with zero-filled buckets and a null source update timestamp.

### Provider reporting view

The endpoint reads only `public.mad_booking_analytics`. The booking owner must
expose `booking_id` (non-null UUID), `check_in_date` (non-null hotel-local DATE),
`status` (TEXT) and `updated_at` (non-null TIMESTAMPTZ). The owner manages the source
and view; MAD does not create, mutate or synthesize bookings. For the existing
unprefixed booking schema, the owner can provision this projection:

```sql
CREATE VIEW public.mad_booking_analytics AS
SELECT booking_id, check_in_date, status::text AS status, updated_at
FROM public.bookings;
```

Adapt the projection to the real provider schema before running it. If check-in
is stored as an instant instead of a DATE, the owner must convert it to the hotel
timezone before projecting the date. Source indexes on `check_in_date`,
`booking_id` and `updated_at` support candidate selection, deduplication and the
freshness query. Latency still requires measurement against the actual source.

After provisioning the view, rerun `npm run migration:run` with the owner
connection and the correct `MAD_DB_ROLE`. The migration runner grants SELECT on
the view when present, revokes runtime writes, and checks the effective shared
write boundary. It safely skips an absent view so the foundation can start before
the external provider is available. Grant updates run on every migration invocation
even when no schema version is new. Do not grant MAD write access to the source.

### Verification handoff

No tests were run while implementing DDP-009. See [the test register](test/README.md)
for the included cases and commands. Runtime acceptance, real-provider agreement,
performance and CI results are not established by source or static checks alone.
