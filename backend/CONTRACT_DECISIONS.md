# Current contract decisions and open agreements

DDP-037 reconciliation, 2026-10-21. This is a description of existing implemented
choices and user-approved policies, not a newly negotiated cross-team contract.
DDP-038 now provides a [contract pack](contracts/DDP_038_CONTRACT_PACK.md),
[metric examples](contracts/DDP_038_METRIC_EXAMPLES.md),
[blocking-decision register](contracts/DDP_038_REVIEW_REGISTER.md) and an actual
new [ADR-038-001](contracts/decisions/ADR-038-001.md). The ADR records existing
choices and proposals; cross-team/supervisor approval remains pending.

| Decision                    | Current implementation / source                                                                                                              | Remaining agreement/evidence                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Independent subsystem login | MAD issues manager JWTs; routing-only gateway; [auth service](src/auth/auth.service.ts)                                                      | Each of the six owners must enforce their own login/session/role contract.                                                              |
| Initial manager             | Seed by email only when absent, preserve existing account, mandatory first password change; [bootstrap](src/auth/initial-manager.service.ts) | Actual DB/manual grants and staging verification.                                                                                       |
| Session security            | HS256, audience mad, issuer, eight hours, DB revocation/session version/activation, manager role; [token service](src/auth/token.service.ts) | Other subsystems must not treat signature verification alone as revocation enforcement.                                                 |
| Analytics                   | Check-in-date bookings, Asia/Colombo, Monday weeks; completed-payment revenue, LKR cents, whole-period comparison                            | Approved implementation policy; refund-event accounting/conversion is absent, not silently implied. See [API metrics](API_CONTRACT.md). |
| Promotions                  | ASCII normalized codes, integer percentages/LKR cents, inclusive start/exclusive end, optimistic versions, logical deletion                  | MAD broker publication implemented; actual HW consumer/acknowledgement/redemption integration and staging evidence pending.             |
| Complaints                  | FOSS source ownership with authorized MAD status/resolved-time updates; MAD-private notes/history/outbox; no reopening                       | Actual FOSS ownership/grant/provider agreement and notification consumption.                                                            |
| Operational data            | FDS/KMS/WKMS own source writes; MAD snapshots/read-only, updated_at microsecond versions                                                     | Producer outbox contracts and authoritative source version advancement must be confirmed.                                               |
| Stock alerts                | Four source states; temporary disabled treated unavailable; Available clears; durable current alert and bounded broker retry                 | KMS adoption of the implementation-approved proposed contract; DDP-043 API/UI still absent.                                             |
| Manual database changes     | DB_SYNCHRONIZE=false; only reviewed manual supplements, runtime least privilege                                                              | Actual Neon comparison/grants/applied-revision evidence, no automatic migration assumption.                                             |
| Browser transport           | Same-origin BFF/HttpOnly cookie; REST gateway; one-use ticket and direct/proxied WebSocket                                                   | Upgrade-capable ingress and one MAD instance until shared tickets/fanout exist.                                                         |

Do not describe entity `version` as schema version. Current events carry no
schemaVersion field. Breaking wire changes need explicit owner agreement and
versioning/migration policy before rollout. DDP-043 alert listing/read state,
DDP-045 task limits and DDP-046 real-service acceptance remain open where absent.
