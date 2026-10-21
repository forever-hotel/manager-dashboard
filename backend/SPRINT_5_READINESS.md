# DDP-017: foundation / v0.1.0 readiness

Reviewed 2026-10-21. **Gate: NOT ACCEPTED.** Implementation preparation is complete;
executed acceptance is not. No local tests, hosted SQL or release actions ran.

The [acceptance register](release/v0.1.0/acceptance-register.csv) contains the 52
criteria from DDP-001 through DDP-017, with candidate verification links, expected
results and NOT_RUN status. Links identify candidate coverage, not verified passes.
The original tickets' central Auth and startup migration assumptions are superseded
by the user's independent-login and manually managed Neon decisions. See
[contract decisions](CONTRACT_DECISIONS.md) and the pending DDP-038 ADR approval.

## Required evidence

1. Supply the candidate commit, comparison baseline, CI run URL and staging URL.
   Use dedicated staging/test accounts and provider configuration, never production
   customer data. Do not place passwords, keys or tokens in evidence files.
2. Run `.github/workflows/ci.yml` on that candidate. Backend and frontend lint,
   format, build, unit/component coverage, real disposable PostgreSQL/RabbitMQ
   integration, browser acceptance, container smoke and dependency gates must pass.
3. Attach whole-suite and changed-code reports. Changed instrumented lines/branches
   must reach 80%; configured critical branches must reach 90%. The CI LCOV checker
   writes `coverage/changed-coverage.json` with baseline/candidate SHAs. Review the
   configured coverage scope and every delivered endpoint's assertion coverage.
4. Execute the [staging review](release/v0.1.0/STAGING_REVIEW.md), recording actual
   results, dates, relevant provider versions and evidence links against AC IDs.
5. Record defects for failures, retest after fixes, and obtain reviewer approval.
   Finalize [release notes](release/v0.1.0/RELEASE_NOTES.draft.md) and the
   [retrospective](release/v0.1.0/RETROSPECTIVE.draft.md) only after acceptance.

Source-to-test mapping: auth/setup uses `test/foundation.e2e-spec.ts`; booking and
revenue use `test/bookings.e2e-spec.ts`; occupancy/low-booking use
`test/occupancy.e2e-spec.ts`; staff provisioning/reset/profile use
`test/staff.e2e-spec.ts`. Frontend auth/navigation/analytics/occupancy/staff tests
and `test/browser/auth.spec.ts` complement those backend suites. Existing test
commands are in [the developer guide](DEVELOPER_GUIDE.md).

## Gate decision

| Criterion      | Current result | Required closure                                                                      |
| -------------- | -------------- | ------------------------------------------------------------------------------------- |
| TC-MAD-017-AC1 | Pending        | Passing final-commit CI, measured coverage and endpoint integration evidence          |
| TC-MAD-017-AC2 | Pending        | Recorded real-provider staging login, analytics and staff provisioning/reset evidence |
| TC-MAD-017-AC3 | Blocked        | Close failures, approve release readiness, then finalize review/notes/retrospective   |

An unavailable provider, missing evidence, unresolved security/review blocker or
failed check keeps this gate open. A source audit cannot publish v0.1.0 or mark
DDP-017 Done. Current DDP-035 security dispositions also apply to any release of
the present code, even if the original foundation scope predates that review.
