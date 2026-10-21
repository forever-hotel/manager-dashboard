# DDP-040 promotion publication and HW checkout contract

MAD publication is implemented, **disabled by default**. HW consumer/checkout
adoption, owner agreement and actual staging redemption remain pending; this guide
does not claim AC1-AC3 have passed. No tests or hosted SQL were run locally. The
existing promotion UI/labels remain unchanged and always distinguish publication
state from confirmed website availability.

## Manual setup

1. Review/apply `deploy/neon-mad-promotion-publication.sql` manually after the
   existing promotion/lifecycle supplements. It adds next_attempt_at and an index
   to the existing outbox, with no booking/source data changes. Replace the
   commented mad_runtime grant with the actual restricted runtime role: the
   publisher needs SELECT/UPDATE on mad_promotion_outbox. Nothing runs at startup.
2. HW must provision its **durable** queue and bindings on durable topic exchange
   hotel.events for promotion.upsert and promotion.deleted (or promotion.\*), with
   reviewed persistence, retry/DLQ policy and access credentials. MAD does not
   create, purge or manage HW queues. No HW queue means mandatory publication
   is returned and MAD retains failed work.
3. Configure MAD_PROMOTIONS_PUBLISH_ENABLED=true in private root .env for Compose,
   or backend/.env for host-run development, only after SQL and HW routing exist.
   RABBITMQ_URL is required, independently of MAD_REALTIME_ENABLED. Default false
   is safe on installations without the new column or HW consumer contract.
4. Recreate/restart the backend with new environment values. No frontend secret,
   new public REST endpoint, shared JWT or additional login is introduced.

## Durable publication semantics

Promotion writes already commit offer state/associations and immutable outbox
payload in one transaction. The worker polls every250ms, one in-flight record per
instance. SELECT FOR UPDATE SKIP LOCKED prevents concurrent workers claiming the
same row; an unpublished lower version blocks later versions of that promotion,
including while the older record is backing off. Other promotions may progress.

The transaction holds its outbox row lock through publisher confirmation. Messages
are persistent, mandatory-routed and use a confirm channel. Missing routing,
broker nack, connection or five-second confirm timeout keeps published_at null,
sets fixed safe last_error PROMOTION_PUBLICATION_FAILED, increments attempts and
persists exponential retry1/2/4/... seconds capped at one hour. Failed work is
retained indefinitely for repair; no successful publication is fabricated. A
malformed private outbox record also stays failed/pending for operator repair.
Per-attempt connections are closed; this favors simple recovery at low promotion
volume, not high-throughput broker connection pooling.

Only broker confirmation marks published_at and clears last_error. A database
failure during that mark rolls back: the same event ID can be delivered again
after restart. This is **at least once**, not exactly once. Attempt timestamps
and IDs come from committed outbox data, never regenerated on retries. Attempts
are capped to avoid integer overflow. The poll has no measured latency guarantee.

published_at means **broker accepted a routed message**, not that HW applied it,
accepted checkout or acknowledged the offer. A binding owned by some other
consumer is not proof HW is available. PENDING/FAILED/NO_PENDING_WORK UI labels
retain their existing unconfirmed-website wording. HW application receipts and
monitoring must be agreed before displaying a verified website state.

## Proposed HW wire contract (producer implemented, owner adoption pending)

Routing key equals type, promotion.upsert or promotion.deleted. JSON envelope:

```json
{
  "eventId": "67f4568c-89ab-4c12-b321-123456789012",
  "type": "promotion.upsert",
  "promotionId": "77f4568c-89ab-4c12-b321-123456789012",
  "version": 2,
  "occurredAt": "2026-10-21T00:00:00.000Z",
  "promotion": {
    "id": "77f4568c-89ab-4c12-b321-123456789012",
    "version": 2,
    "deletedAt": null,
    "publicationStatus": "PENDING",
    "code": "WEEKDAY25",
    "discountType": "PERCENTAGE",
    "discountValue": 25,
    "currency": "LKR",
    "validFrom": "2026-10-01T00:00:00.000Z",
    "validUntil": "2026-11-01T00:00:00.000Z",
    "roomTypeIds": ["87f4568c-89ab-4c12-b321-123456789012"],
    "maxRedemptions": 10,
    "currentRedemptions": 0,
    "status": "ACTIVE",
    "lifecycleState": "ACTIVE",
    "createdAt": "2026-10-01T00:00:00.000Z",
    "updatedAt": "2026-10-21T00:00:00.000Z"
  }
}
```

eventId is immutable UUID; promotionId/promotion.id match; version is the
promotion's nonnegative optimistic integer, not updated_at microseconds or schema
version. occurredAt is immutable outbox created_at in UTC. No schemaVersion field
is added. Body max8192bytes; AMQP messageId=eventId, contentType application/json,
type=routing key. promotion is the existing API projection at commit time;
publicationStatus/lifecycleState/currentRedemptions are historical hints, **not
checkout authority**. Expiry and exhaustion require current validation, not a
new event arriving on the expiry instant. No credentials/guest/booking data is sent.

HW consumer requirements: validate exact IDs/types/ranges, persist event receipt
and projection atomically, deduplicate immutable event IDs, reject conflicting
ID reuse, and ignore lower/equal promotion versions. Keep deletion tombstones
so delayed upserts cannot resurrect offers. ACK only after HW commit; use durable
retry/DLQ for provider failures. Retain existing bookings/history. These are review
requirements, not code silently installed in the separate website repository.

## Final checkout requirements and deterministic contract fixtures

HW owns checkout, charge/booking consistency and atomic redemption. Do not accept
an eventually consistent cached projection as sole authority during a publication
partition: revalidate authoritative current offer/counter under the agreed write
protocol, or fail closed. Shared-table writes require explicit owner/grant
approval; MAD publication needs no redemption UPDATE permission.

At redemption transaction time enforce active, non-deleted, start<=now<end,
eligible room type and current_redemptions<max_redemptions. This proposes validity
as **redemption time**, not a new stay-date restriction (no separate stay-window
fields exist). HW still validates the booking's check-in/out dates independently.
Use LKR integer cents. Proposed percentage rounding is floor to a cent and fixed
discount capped at subtotal; never allow a negative booking total. Example:
25% of10000cents=2500; fixed20000 against10000 is10000;33% of101 is33. Rounding/
redemption-time semantics require explicit HW agreement before checkout rollout.

The authoritative counter check/increment and booking redemption receipt must
commit in the same transaction, with row lock or conditional UPDATE. Use a stable
checkout/idempotency key and return the existing committed receipt for repeats;
do not increment again on HTTP/broker retry. If charge or booking fails, roll back
or use an agreed compensating reservation protocol. Never overwrite live counters
with stale values from an offer event. A reduced offer limit must respect already
consumed redemptions and historical booking discount amounts.

Examples for owner review:

| Case                                                   | Required outcome                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Ineligible room type, before validFrom, at validUntil  | Refuse new redemption                                                               |
| Deactivated/deleted or current count==max              | Refuse; retain prior bookings                                                       |
| Duplicate event / delayed older upsert after deletion  | No extra redemption; no resurrection                                                |
| One remaining use, two distinct simultaneous checkouts | Exactly one new booking/redemption commits                                          |
| Same checkout idempotency key repeated                 | Same committed receipt; no extra increment/charge                                   |
| HW/broker unavailable                                  | MAD retains/retries publication; HW cannot blindly honor an unvalidated stale offer |

## Tests and evidence register

All High priority; **authored, not run locally**. The helper
`test/fixtures/hw-promotion-contract.ts` is a **test-only review oracle**, not a
production HW consumer or checkout endpoint. Its Map deduplication is not durable
storage or proof of distributed concurrency. The DB fixture separately exercises
an atomic conditional counter+booking SQL statement on a disposable database.

| ID             | Requirements / candidate files                                                                         | Expected / remaining evidence                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-MAD-040-AC1 | MD-05c/HW-10; publication spec, promotion-contract.spec.ts, promotions.e2e-spec.ts                     | Real broker receives the committed scoped terms; oracle validates percentage/fixed/room/time boundaries. Actual HW consumer/checkout adoption and staging success pending.                                                                                                 |
| TC-MAD-040-AC2 | promotion-contract.spec.ts, existing promotion lifecycle API/DB tests, new atomic checkout SQL fixture | Inactive/deleted/expired/exhausted rejected; booking history retained. Actual website enforcement pending.                                                                                                                                                                 |
| TC-MAD-040-AC3 | promotion-publication.spec.ts and promotions.e2e-spec.ts                                               | Confirm-before-mark, mandatory return/nack/timeout failure, durable backoff, restart/stable ID, concurrent publisher row locking; reference consumer version/dedup and atomic final-use SQL fixture. Actual HW idempotency/charge concurrency and outage recovery pending. |

No public API changed; existing promotion REST authorization/input/version tests
remain required. CI must run full unit/coverage/component/integration checks with
disposable PostgreSQL/RabbitMQ. Verify low-water retry timing, poison record repair,
queue durability, consumer restart, duplicate deliveries, repeated checkout IDs
and real payment/booking rollback on staging. Record SHA, provider revisions,
test IDs, correlation IDs, CI artifacts, redacted HW receipts and owner sign-off.
NFR-02 propagation<=1second is a staging measurement, not inferred from250ms polling.

Before final acceptance, HW must supply its consumer and atomic checkout endpoint,
owner-approved contract/grants, deployment date and real staging checkout evidence.
DDP-040 cannot be marked fully accepted from this repository's publisher/oracle alone.
