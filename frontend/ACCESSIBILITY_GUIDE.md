# Accessibility - DDP-048

Implementation prepared 2026-10-21. Tests have **not run locally**. No claim of
WCAG 2.1 AA compliance or passing staging acceptance is made from source review.
The existing desktop layout, data policies, login and API behavior are retained.
Focus indicators and narrow-width reflow are intentional accessibility changes.

## Changes and existing alternatives

- Global keyboard focus outlines cover links, buttons, form controls and focusable
  regions. Main content becomes inert while mobile navigation is open; Tab wraps
  within navigation, Escape closes it, and focus returns to its trigger. Existing
  persistent logo, skip link and desktop navigation are retained.
- Staff reset/deactivation confirmations receive focus, expose a description,
  cancel on Escape when idle and restore opener focus. They remain non-modal:
  users can Tab to other controls; no artificial focus trap is introduced.
- All horizontally scrolling data tables have named keyboard-focusable regions.
  Staff, complaint and promotion tables also have screen-reader captions. Their
  existing visual borders and data are retained; clipped tables now scroll.
- Narrow/zoomed widths wrap filters and controls, stack existing three/four-column
  cards and prevent long references from forcing the page wider. Desktop layout
  remains unchanged. Seven-column calendar dates retain their existing structure.
- Booking charts already expose SVG title/description and exact daily-data tables.
  Food/request/worker analytics already use captioned tables; occupancy has a
  table, percentage/count labels, text demand levels and legend. Room/task/kitchen
  states include text labels, and notification/error/success messages use status
  or alert semantics. Retain these equivalents when modifying charts or colours.

## Automated checks for CI/operator execution

From `frontend/` after the normal reviewed dependency installation:

```powershell
npm run test:cov
npm run test:e2e -- test/browser/accessibility.spec.ts
```

Do not run these against production. Playwright uses the existing disposable
database-backed contract stack. The browser suite now automatically discovers
these checks in the existing CI job; no additional workflow or production
instrumentation is needed. `axe-core` is declared directly at the already-locked
version 4.14.0 instead of relying on ESLint's transitive dependency.

`test/browser/accessibility.spec.ts` scans login, mandatory password change and
all 12 dashboard destinations with WCAG 2.0/2.1 A/AA axe rules (including colour
contrast). It also checks mobile Tab/Shift+Tab/Escape/focus restoration and Reports
control access at 320, 768 and 1280 CSS pixels. No rule exceptions or hidden
violation exclusions are added. A reduced viewport approximates available width
at zoom; it is not proof of actual browser zoom or text scaling.

Component regression coverage:

- `test/navigation.test.tsx`: inert background, navigation focus and Escape return.
- `test/staff.test.tsx`: confirmation focus, accessible description, Escape return
  and no mutation on cancellation; existing successful action/conflict cases.
- `test/analytics.test.tsx`, `test/occupancy.test.tsx`, `test/operations.test.tsx`:
  chart/table/heatmap data equivalence and labelled controls.
- `test/notifications.test.tsx`, `test/reports.test.tsx`: alert persistence and export controls are
  supported by existing feature coverage; actual speech still needs review.

Automated scans cannot establish every screen-reader experience, control state,
keyboard journey, contrast combination or zoom behavior. A pass on an empty or
unavailable data view does not certify a populated chart/table. Use representative
fixtures and execute every state in the register before accepting the ticket.

## Manual walkthrough and evidence

Record candidate SHA, CI/job links, coverage, browser/OS/assistive-technology
versions, viewport/zoom, fixture IDs, actual outcomes, screenshots/traces and
reviewer/date in [the register](accessibility-register.csv). Status is NOT_RUN
until execution; use FAIL with a defect link when a check fails. Keep credentials,
tokens and real guest/staff data out of evidence.

1. With keyboard only, cover login, first-password change and logout; traverse
   every sidebar destination, open/close mobile navigation, use skip link and
   verify visible focus never disappears behind the sticky header. Test forward
   and reverse Tab and Escape. Ordinary non-modal content must remain escapable.
2. On every view, operate period/date filters, pagination and sort controls.
   Create/edit/confirm/cancel staff and promotions, resolve a complaint with an
   internal note, adjust task limit, read an alert and export CSV/PDF. Include
   invalid input, busy, error/retry, conflict, empty, populated and stale states.
   Verify labels, error associations and focus after asynchronous updates.
3. Use NVDA/Firefox or the team's supported equivalent and VoiceOver/Safari where
   supported. Read chart titles plus exact table values, occupancy date buttons,
   legend, unknown capacity, status words and source freshness. Change periods
   and verify the equivalent data follows the visible selection. Check logical
   heading/table order, unique control names and read-only task/room semantics.
4. Trigger real staging stock/complaint notifications and reconnection failures.
   Verify meaningful announcements without focus stealing or repeated speech on
   unchanged polling, and consistent counts after read/resolution. Screen-reader
   speech cannot be inferred solely from a DOM role attribute.
5. At supported desktop/tablet dimensions, test actual 200% browser zoom and
   text-only scaling, plus 400% reflow at a 1280px baseline (320 CSS px equivalent).
   Reach every control without clipping, overlap or two-dimensional page scrolling;
   genuinely tabular data may scroll inside its labelled region. Test calendar
   date text, long IDs, long labels, menus and export controls. The 320px automated
   Reports check supplements, rather than replaces, these full-page walkthroughs.
6. Measure normal/hover/focus/selected/error/disabled-state contrast with rendered
   computed colours, including heatmap/legend and translucent text backgrounds.
   WCAG AA requires 4.5:1 for normal text, 3:1 for large text and applicable UI
   components. Test forced colours/high contrast and visible focus manually.

Do not mark DDP-048 Done until all three AC groups, relevant feature regressions,
required changed-code coverage and CI pass; all manual defects are fixed/retested;
and peer/staging review is attached. There are no backend/API/schema changes, so
no new API integration suite or SQL supplement is required for this ticket.
