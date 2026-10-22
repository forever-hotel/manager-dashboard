# Synthetic fixtures, reset and fallback

Plan only: no seed SQL or source-service changes were executed. Fixture owners
must approve and seed the real isolated demonstration services through their own
interfaces or reviewed tooling. Never bulk-reset Neon/shared staging or use
production guests/accounts. Record resulting IDs, schema/provider revisions,
seed time and snapshot/checksum in the restricted fixture ledger.

Let D be the agreed demonstration day in Asia/Colombo. Recalculate day/week/month
boundaries immediately before rehearsal; weeks start Monday. Use a stable snapshot
for displayed-versus-export comparison. Changing the machine clock is not a seed.

| Fixture group            | Proposed realistic data and expected check                                                                                                                                                                 | Responsible source owner    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Manager                  | Existing changed-password manager plus an isolated first-login manager; private credentials outside recording                                                                                              | MAD/auth owner              |
| Rooms/bookings           | Six rooms: five eligible and one maintenance. Three eligible bookings in distinct rooms on D (two confirmed, one checked in), check-out D+1; one booking D+1; a cancelled booking excluded.                | HW/FDS                      |
| Occupancy/demand         | D:3/5=60%; D+1:1/5=20% low demand. Use a separate owner-approved all-zero-capacity fixture profile for unknown capacity, not a concurrent contradictory room snapshot.                                     | HW/FDS                      |
| Payments                 | D COMPLETED100000+150000 LKR cents; PENDING50000 and REFUNDED70000 excluded. Previous-day COMPLETED200000 yields25% day comparison. Derive whole-week/month totals independently from the complete ledger. | Payment/HW owner            |
| Promotions               | Separate unique percentage/fixed codes, eligible/ineligible rooms, scheduled/expired/exhausted examples and historical booking usage. Avoid code reuse: logical deletion retains its code/history.         | MAD + HW                    |
| Staff                    | One synthetic account for each of the four provisionable roles, unique test-inbox addresses and valid profile fields; separate disposable accounts for destructive reset/deactivation variants.            | MAD + owning login services |
| Kitchen/food/stock       | Real orders across PLACED/IN_PREPARATION/READY/DELIVERED, known item quantities/placement hours; menu items with low/unavailable/available stock. Derive analytics from agreed cohorts.                    | KMS/FOSS                    |
| Requests/workers         | Requests with known creation/completion durations and unresolved examples; workers with known completed/active tasks and open complaints. Include excluded invalid-duration fixture separately.            | FOSS/WKMS                   |
| Complaints/notifications | Synthetic submitted/reviewed/resolved complaints; one unread and one read-but-active alert. Source changes permit notification persistence/clearing proof without using guest data.                        | FOSS/KMS + MAD              |
| Task limit               | Confirm default3, a pending version and limit2 with one worker already at3 active tasks; separate worker at1 for concurrent one-slot claims. Assigned active states only.                                  | WKMS + MAD                  |
| Reports/accessibility    | Long safe labels, Sinhala/Tamil/English synthetic names, empty and unknown results, all seven report types and both formats; invalid CSV formula-like text only in isolated safe fixtures.                 | QA + data owners            |

The counts above are planned expected values, not claims about a current database.
The ledger must reconcile links between booking/payment/room/worker/complaint IDs.
Document actual provider policy differences before accepting the fixture; do not
edit shared-source data directly from MAD just to match a slide.

## Controlled reset

1. Stop demonstration actions and preserve failed evidence. Agree whether to use
   another unused synthetic fixture or restore an isolated snapshot. Owners must
   authorize any reset; this package contains no automatic deletion/restore script.
2. Preserve the manager's changed password/session rules; restarting must never
   restore an initial password. Generate new staff fixtures via normal provisioning
   rather than replaying old temporary credentials or email outbox messages.
3. Use new promotion codes and fresh source events/versions. Do not clear history,
   reset redemption counters on used codes or replay stale events as current.
4. Coordinate each source owner and MAD's dependent history/outboxes/read receipts.
   For snapshot recovery use DDP-050's isolated reference/restore procedure and
   disable real email/event integrations. A MAD-only dump cannot reset other
   systems' delegated fields or foreign-key references safely.
5. Reconcile expected totals, roles/grants, schema versions and source connectivity;
   execute authorized readiness/functional checks and record the reset result.
   Resume only with a new ledger/version attached to the demo record.

## Fallback recording and failure decision

Before the panel session, record the accepted candidate with approved synthetic
data, all requirement/role/export variants, audible narration and readable tables.
Record UTC/Asia-Colombo date, SHA/digests, provider revisions and checksums; remove
credentials, inbox secrets, tokens, real guest details and private feedback. Add
captions/transcript and panel/hotel access-tested links in artifacts.csv.

If live services fail, show the actual error, record the affected requirement and
switch only to the clearly labelled previously recorded demonstration. State its
candidate/date and the live gap. A recording cannot turn failed live acceptance
into PASS or claim integration with a provider that was mocked. Keep a sanitized
offline PDF/CSV sample and slides for explanation; never present them as freshly
exported live data. Do not invent a recording URL before the recording exists.
