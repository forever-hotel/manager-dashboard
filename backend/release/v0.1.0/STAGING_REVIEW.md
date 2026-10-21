# v0.1.0 staging review procedure

Execution status: NOT_RUN. Candidate SHA, baseline SHA, staging URL, review date,
reviewer and owning provider revisions: pending. Enter actual results/evidence in
the [acceptance register](acceptance-register.csv); do not replace NOT_RUN with PASS
without executing and reviewing that case. Keep credentials out of this pack.

1. Confirm reviewed manual Neon schema/grants, HTTPS/cookie settings, independent
   subsystem auth contracts and configured SendGrid test sender. Check live and
   readiness endpoints. Startup must not migrate/synchronize the shared schema.
2. On a dedicated absent manager identity, provision from env, sign in and verify
   first-password-change gating. Change the password; restart and confirm the new
   password works and the initial credential was not restored. Verify wrong login,
   logout/revocation, expiry, disallowed roles and protected direct-page navigation.
3. Navigate every shell link at a narrow viewport and by keyboard. Verify the
   visible logo, menu access/focus, active page and no protected-content flash.
4. Using approved fixtures, compare day/week/month booking totals/trends against
   check-in dates in Asia/Colombo, Monday weeks, included/cancelled statuses and
   zero-filled boundaries. Compare revenue against COMPLETED payments by paid_at,
   LKR cents and approved whole-period comparison. Previous zero must show N/A.
5. Check occupancy overlap/deduplication, excluded checkout day, leap/month
   boundaries, maintenance denominator and null zero-capacity rates. Compare the
   calendar, legend and accessible date descriptions against the source API.
6. Check the next 14 dates' low-booking threshold boundaries, unavailable capacity
   and safe source errors. The API suggestion is in scope; later DDP-057 action/date
   prefill is not accepted by this foundation review.
7. Provision each supported staff role with test mailboxes. Verify unique account,
   email queue/delivery, duplicate/invalid input, safe profile edits, version
   conflicts, reset, activation changes and no plaintext credentials in responses.
   Verify actual owning subsystem first-password change and old-session denial;
   a mocked SendGrid response or MAD-only guard is insufficient provider evidence.
8. Simulate provider/database unavailability safely in a dedicated test deployment,
   checking readiness, sanitized errors, preserved form input and retries. Do not
   modify or interrupt shared production services for these checks.

Capture browser/API results, fixture IDs, expected/actual values, job/artifact
links, provider contract revisions, defects and retest links. Redact guest/staff
personal information and all secrets. Missing provider access remains BLOCKED.

Release readiness remains unaccepted until register outcomes, security disposition,
coverage and reviewer sign-off are complete. Do not tag/publish from this worksheet.
