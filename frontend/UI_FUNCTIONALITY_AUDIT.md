# UI restoration: functionality review

Compared the working dashboard before restoration with the UI from commit
`6a2af485`. The eight reference dashboard pages retain their original markup and
mock content. Authentication and navigation use the existing application contracts.

## Regressions repaired

- Restored username/password login and its 100-character username limit. The UI
  restoration's email lookup and expanded backend input limit were reverted.
- Restored first-login redirection, safe return destinations, duplicate-submit
  protection, password-manager autocomplete and the expired-session notice.
- Added Logout to the styled sidebar. It calls the existing server logout endpoint,
  waits for successful revocation/cookie removal and replaces the page with login.
  Failures keep the session and offer a retry; repeated clicks cannot submit twice.
- Replaced the mock staff name and initials with the authenticated username.
- Restored links to Notifications, Tasks, Reports and Settings, giving access to
  all 12 existing dashboard routes.
- Restored mobile navigation, menu closing on navigation, the skip-to-content link,
  the navigation label and current-page semantics. Desktop styling follows the
  reference design; responsive classes support the existing mobile behavior.
- Removed the hard-coded complaint badge of 3 because it was not a live count.

## Authentication preserved

Startup provisioning, existing-account preservation, password hashing, forced
first-password change, account lockout, JWT validation, HttpOnly cookies, session
revocation, protected routes and periodic session revalidation remain in place.
No database schema or environment credentials were changed by this repair.

## Mock-only features and remaining differences

The reference Analytics, Rooms, Promotions, Staff, Food Orders, Service Requests,
Complaints and Worker Performance pages display the original sample content.
Their charts, counters, filters and action buttons are design demonstrations where
the reference commit supplies no handlers or API calls. The preceding UI had
placeholder pages, so these are not replacements for implemented CRUD screens.
The booking and occupancy backend APIs remain implemented, but this UI restoration
does not connect those pages to them.

The four newer routes absent from the reference commit retain their existing
placeholder content. The first-password-change screen retains its working form.
The reference Inter font introduces font downloads; it does not change auth.

## Verification

Source review and UTF-8/whitespace checks performed. Updated regression tests cover
username sign-in, first-password-change routing, logout success/failure, actual
user identity, mobile navigation and all route links. The Docker build request
was declined; these changes have not been verified by a build or test run.
