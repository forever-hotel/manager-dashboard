# Audit, monitoring and recovery - DDP-050

Prepared 2026-10-21. Application support and infrastructure templates are present.
**Tests, log-storage installation, backups and restore rehearsals were not run
locally. Acceptance remains pending actual configuration and evidence.** No hosted
schema, hotel business data or existing UI was changed.

## Application contract

Backend requests receive a server-generated UUID in `X-Correlation-ID`. Completed
mutations and HTTP errors emit `http.operation` records with timestamp, service,
verified actor UUID (or anonymous), correlation ID, fixed resource/method, HTTP
status, outcome and duration. Aborted responses emit UNKNOWN_ABORTED once. Successful
reads update bounded counters without audit noise. Bodies, query strings, headers,
passwords, cookies/JWTs, names/emails, complaint notes and raw exceptions are omitted.
Client correlation headers and arbitrary paths cannot create log labels.

Production uses Nest's JSON ConsoleLogger; local operators can set LOG_FORMAT=json
in the process environment before startup. Audit fields appear inside its JSON
message envelope. Domain transaction histories remain authoritative: HTTP success
is a request outcome, not a new durable transactional audit. Process death before
completion can lose an HTTP record. UNKNOWN_ABORTED does not imply SQL rollback.

`GET /mad/operations/status` is manager-only, with401 for missing/invalid sessions
and403 for disallowed/first-login sessions. It returns dependency states and
process-local request/failure counts, disjoint latency buckets and process age.
It returns200 with `status=degraded` for source failures; alert on the body too.
DB failure may prevent authentication and return503; existing public readiness
independently checks DB/auth-table permissions. Liveness remains independent.

The sequential ten-second monitor checks DB connectivity and existing kitchen,
room, task, stock and notification health flags. State changes/recovery emit
`dependencies.changed`. Disabled transport is labelled disabled. `databaseCheckedAt`
is the last DB observation; `observedAt` is the status-read time. Counters reset on
restart and uptimeSeconds is not monthly availability. `auditEmitter` detects only
synchronous logger failures, not delivery/durable retention: separately monitor
collector delivery, disk and missing records. No anonymous metrics or new UI added.

## Retention and infrastructure setup

Review [policy.json](../deploy/operations/policy.json) with infrastructure/DB owners.
No platform or recipient was supplied; alert routing/escalation and actual storage
are pending. Proposed RPO24h/RTO4h are not agreed or measured objectives.

On the dedicated Ubuntu/Debian staging host:

1. Provision `/var/log/mad`, syslog:syslog, mode0700. Review/install
   `deploy/operations/rsyslog.conf` under `/etc/rsyslog.d/` and logrotate.conf under
   `/etc/logrotate.d/`. Validate with `rsyslogd -N1` and `logrotate --debug` before
   enabling; do not force real rotation just to validate syntax.
2. Enable the loopback TCP1514 collector before staging deployment. The staging
   Compose backend now uses Docker's host syslog driver and fixed mad-backend tag.
   Local-development Compose is unchanged. Collector failure can prevent container
   startup; DDP-049 must report that deployment failed.
3. The template writes private0600 operations.log and retains400 daily archives,
   exceeding12 calendar months with the daily schedule. Prohibit size-triggered
   or repeated forced daily rotations. Verify rotated permissions and audited
   operator read access; ordinary developers/application containers cannot read it.
4. Provision disk for400 days/growth, collector/disk/rotation alarms and encrypted
   off-host copies with the same or longer retention and reviewed deletion ACLs.
   Local rotation is not disaster recovery or tamper-proof storage. Disk exhaustion
   or manual deletion invalidates retention; attach actual storage/ACL evidence.
5. Integrate DEGRADED state records, synchronous audit failures, missing probes,
   failed/missing backups and collector/disk faults with the team's alert platform.
   This task sends no messages and claims no configured external alert recipients.

## Availability measurement

Install operations_probe.py and its staging_smoke.py helper under
`/opt/mad/operations`, with Python3.12, CA trust and Asia/Colombo timezone data.
Provision a nonprivileged mad-monitor user and a private0600 monitor.env:

```dotenv
MAD_MONITOR_APP_ORIGIN=https://mad.staging.example
MAD_MONITOR_API_ORIGIN=https://gateway.staging.example
```

Review/install mad-monitor.service/timer. Its one-minute observation checks both
public readiness endpoints, refuses redirects, logs no bodies/credentials, and
pipes observations to the collector with tag mad-monitor. Verify the installed
logger/rsyslog service path and failure alerts. Add an observer outside the
application host/network for actual end-user reachability/host outage detection.
Readiness alone does not prove every authenticated workflow or broker path.

Operators can summarize existing restricted plain/gzip message-only log copies:

```bash
python3 deploy/operations_availability.py --month 2026-10 /restricted/operations.log /restricted/operations.log-20261020.gz
```

Supply actual existing files. Reporting uses Asia/Colombo calendar minutes;
duplicate failures win, missing/invalid minutes are unknown, and a partial month
cannot pass. A fully observed closed month must reach99.5%. Keep raw observation,
clock-sync, missing-minute and independent-vantage evidence. A short green test
cannot establish monthly uptime or compensate for a missing monitor.

## Backup and isolated recovery

DB owners must approve actual schedule, RPO/RTO, archive retention/encryption and
the hosted provider's recovery window for their configuration. Do not assume a
provider tier supplies a particular window. The daily02:00UTC backup timer is a
proposal, not an enabled backup. Provision PostgreSQL client tools, a dedicated
read-only backup role, protected pg_service.conf/pgpass, encrypted private storage
and a mad-backup user. Review/install backup.sh and mad-backup.service/timer under
`/opt/mad/operations`. Private0600 backup.env example:

```dotenv
MAD_BACKUP_APPROVED=yes
MAD_BACKUP_DIR=/var/backups/mad
PGSERVICE=mad_backup
PGSERVICEFILE=/opt/mad/operations/pg_service.conf
PGPASSFILE=/opt/mad/operations/pgpass
```

The script takes a consistent custom pg*dump of public.mad*\* tables, validates
its archive directory and writes SHA256. It never writes source SQL or deletes
archives. Failed partial archives remain for restricted diagnosis. Monitor failed/
missing runs and replicate encrypted archives off-host. Archive listing/checksum
does not prove restore, sequence/grant integrity or shared-system completeness.

MAD tables reference shared users/complaints. Delegated staff authentication/profile
fields and FOSS complaint status/resolved time live outside mad\_\*. **The scoped
archive cannot recover those fields or the complete hotel database.** Coordinated
provider snapshots and owner-led recovery are required; never overwrite other
services from a MAD-only dump.

Rehearsal steps for DB owners (not executed here):

1. Record snapshot time, schema/provider revisions, owner approvals, backup checksum
   and encrypted archive reference. Freeze synthetic fixtures or coordinate
   consistent snapshots; provision isolated reference/restored DBs without real
   provider/email/broker side effects or production credentials.
2. Restore shared reference schemas/source fixtures through each owner's procedure,
   then MAD data in the isolated target only. Capture fingerprints before/after:

   ```bash
   psql -X -qAt -v ON_ERROR_STOP=1 service=mad_reference_test -f deploy/operations/reconcile.sql > reference.txt
   psql -X -qAt -v ON_ERROR_STOP=1 service=mad_restore_test -f deploy/operations/reconcile.sql > restored.txt
   diff -- reference.txt restored.txt
   ```

   SQL is a read-only repeatable-read snapshot of each MAD table's name/count and
   SHA256 of sorted row fingerprints, with no raw credentials/notes emitted.
   Use matching PostgreSQL/schema/encoding and UTC output. Run it only on isolated
   rehearsal data; it can be expensive. It does not compare sequences, grants or
   delegated shared fields.

3. Reconcile delegated staff/session/complaint fields with owners, sequence next
   values, constraints/indexes/grants, revoked sessions, encrypted credential
   outbox/key availability, promotion versions/delivery, complaint history, task-
   limit history/ACK and read receipts. Do not replay real emails/events.
4. Run applicable disposable API tests and isolated login/denial/mutation/read
   journeys. Record actual restore duration/data-loss interval against approved
   objectives, defects/retests and peer approval. Clean up isolated resources only
   through the DB owner's authorized procedure. Never automatically restore Neon.

## Acceptance and evidence

Table-scoped dumps omit supporting routines such as policy confirmation functions.
Owners must include reviewed manual schema/routines and choose schema-versus-data
restore order, accounting for seeded default rows, before the drill. A blanket
restore into prepopulated tables is not an approved recovery plan.

[operations-register.csv](../deploy/operations/operations-register.csv) tracks the
three AC groups. Attach SHA, CI and measured coverage, restored-fixture results,
storage/ACL/retention configuration, monitor baseline, actual alert routing, owner
approval and dates. Application unit tests and expanded real-PostgreSQL API cases,
protected endpoint inventory, isolated Python probe/report tests are authored but
unrun. Changed-code80% line/branch and critical90% branch coverage remain measured
CI obligations. No SQL supplement or automatic migration/restore was introduced.
Do not mark retention, restore or monthly availability accepted from templates.
