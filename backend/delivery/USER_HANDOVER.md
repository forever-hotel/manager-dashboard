# Hotel manager and staff handover walkthrough

Training script only; trainee names, date, observed task results and actual
acknowledgement remain blank in ASSESSMENT_RECORDS.md. Use approved synthetic data
on an accepted environment. Production access depends on the separate release gate.

## Sign in and keep access safe

Use your assigned manager username and private password. An initial manager is
created only when its configured account is absent; a restart must not replace an
existing password. First login requires changing it before dashboard access. Later
logins use that changed password. Use Logout when finished; session expiry or
revocation requires signing in again. Never share credentials or another role's
session. Ask the authorized administrator for account recovery.

The shared gateway routes APIs; it is not a central login system. Receptionist,
Worker, Kitchen Staff and Kitchen Manager use their owning subsystem's login.
Creating one of those accounts does not grant manager-dashboard access. Kitchen
Manager partial-access rules need an explicit owner/security decision.

## Daily dashboard tasks

| Page                                  | User task and interpretation                                                                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Analytics                             | Select day/week/month; compare bookings and completed-payment LKR revenue. Bookings use check-in date; comparison uses whole previous periods. A missing/unknown comparison is not0%. Read exact chart data in tables.                                                                      |
| Occupancy calendar                    | Change month, focus/select a date, read occupied/eligible rooms and percentage. Demand labels/legend supplement colours; unknown capacity is not an empty hotel. Low-demand suggestion action remains pending DDP-057.                                                                      |
| Food orders                           | Inspect totals/popular items/hours and kitchen progress. Ready for Delivery and Delivered are separately labelled within the existing third column. MAD observes orders; make kitchen changes in the owning system.                                                                         |
| Service requests / Worker performance | Select period/filters and inspect counts, duration units and exclusions/freshness. Missing source data or failed requests must not be read as zero work.                                                                                                                                    |
| Rooms / Tasks                         | Observe current source state and use supported task filters/pagination. MAD cannot edit room states or claim/assign/complete tasks. Use FDS/WKMS for those actions.                                                                                                                         |
| Staff accounts                        | Create the correct role, check delivery feedback, search/filter/edit, reset/deactivate only after reviewing confirmation. Temporary credentials are generated and emailed, never shown here. Reset/role/deactivation must revoke actual owning-system access.                               |
| Promotions                            | Enter a unique code, discount type/value, eligible rooms, validity dates and redemption maximum. Save/publish status must be checked before advertising. Edit with current version; deletion keeps history/code and prevents future use. Website redemption requires actual HW integration. |
| Complaints                            | Find/open a complaint; move Submitted -> Under Review -> Resolved with an internal note/current version. Review stale-version conflicts and reload deliberately. Reopening is not supported. Notes/history remain manager-private.                                                          |
| Notifications                         | Reading marks an alert read; it does not resolve the complaint/stock source. Alerts persist across navigation/login until the source resolves. Banner/sidebar/panel counts should agree; unknown count is not zero.                                                                         |
| Settings                              | Save task maximum1..10, default3. A saved request is pending until WKMS confirms the same version. Reducing the limit retains existing tasks; actual new-claim enforcement is WKMS-owned.                                                                                                   |
| Reports                               | Choose report/allowed filters, then PDF or CSV, from the view or index. Compare with the same source snapshot; data may change between downloads. Keep exports private and follow the hotel's retention policy.                                                                             |

## Keyboard, faults and support

Tab/Shift+Tab moves between labelled controls with visible focus. Use the skip link
to reach content. On narrow screens open the hamburger menu; Escape closes it and
returns focus. Staff confirmations support Escape when idle. Tables can scroll
inside their labelled keyboard-focusable regions; chart tables and demand text
provide non-colour alternatives. Record training issues with actual browser/zoom.

If a view reports unavailable/stale, use its retry/reload control and check source
freshness. Do not repeatedly create/reset/save after an uncertain result: first
refresh and verify whether the operation already committed. Conflicts require
reviewing current data; a retry must not silently overwrite another update. Alert
count unavailable, unknown occupancy and failed metrics are not healthy zeroes.

For support record page/action, time/timezone, safe reference ID and correlation
ID if available. Do not send passwords, cookies, API keys, guest details or notes
in screenshots. Use the named support contacts recorded during handover; no
contact person/phone/email is invented by this document.

## Operator handover

Operators demonstrate, using authorized private access rather than projecting
secrets: clean-checkout setup and separate gateway revision; manual schema/grants;
runtime/registry ownership; TLS/internal staff access; dependency status/audit
correlation; log-retention/alerts; scheduled backup and isolated restore evidence;
and exact-image rollback/approval controls. Use:

- [Setup](../DEVELOPER_GUIDE.md) and [API contracts](../API_CONTRACT.md).
- [Staging](../../deploy/STAGING_GUIDE.md) and
  [release/recovery](../../deploy/release/RELEASE_GUIDE.md).
- [Operations and data recovery](../OPERATIONS_RUNBOOK.md),
  [accessibility](../../frontend/ACCESSIBILITY_GUIDE.md) and
  [actual UAT record](../uat/SIGN_OFF.md).

Retain owner-controlled backup/encryption keys, delivery queues and secrets outside
Git. Do not run startup migrations or automatically restore hosted data. Record
actual trainee task completion and outstanding limitations before handover sign-off.
