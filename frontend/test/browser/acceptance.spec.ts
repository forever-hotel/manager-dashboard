import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { overview } from '../analytics-fixture';
import { roomsSnapshot } from '../rooms-fixture';
import { kitchenSnapshot } from '../kitchen-fixture';
import { foodFixture, serviceFixture, workerFixture } from '../operations-fixture';
import { complaintPage } from '../complaints-fixture';
import { promotion, page as promotionPage, room } from '../promotions-fixture';
import { staffPageFixture } from '../staff-fixture';
import { notificationsFixture } from '../notifications-fixture';
import { occupancy } from '../occupancy-fixture';
import { lowDemand } from '../low-demand-fixture';
async function login(page: Page, username = 'manager') {
  await page.goto('/login');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill('browser-private-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const payload: Record<string, unknown> = {
      '/api/rooms/status': roomsSnapshot(),
      '/api/kitchen/orders': kitchenSnapshot(),
      '/api/analytics/operations/food-orders': foodFixture(),
      '/api/analytics/operations/service-requests': serviceFixture(),
      '/api/analytics/operations/worker-performance': workerFixture(),
      '/api/service-requests': { requests: [], total: 0, page: 1, pageSize: 20, view: url.searchParams.get('view') },
      '/api/complaints': complaintPage(),
      '/api/promotions': promotionPage([promotion()]),
      '/api/promotions/room-types': [room],
      '/api/staff': staffPageFixture(),
      '/api/notifications': notificationsFixture(),
      '/api/analytics/occupancy': occupancy(url.searchParams.get('month') ?? new Date().toISOString().slice(0, 7)),
      '/api/analytics/low-booking-alerts': lowDemand()
    };
    if (Object.hasOwn(payload, url.pathname)) await route.fulfill({ json: payload[url.pathname] });
    else await route.continue();
  });

  await page.route('**/api/analytics?**', route => route.fulfill({ json: overview('week') }));
  await page.route('**/api/realtime/ticket', route => route.fulfill({ status: 503, json: {} }));
});
test('login protects pages, rejects bad credentials and stores only an HttpOnly session', async ({ page, context }) => {
  await page.goto('/analytics');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Username').fill('manager');
  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#password-error')).toContainText('Unable to sign in');
  await login(page);
  await expect(page).toHaveURL(/\/analytics$/);
  const cookie = (await context.cookies()).find(cookie => cookie.name === 'mad_session');
  expect(cookie?.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('mad_session');
  await page.getByRole('button', { name: /Open account menu/ }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/rooms');
  await expect(page).toHaveURL(/\/login/);
});
test('first login requires a password change before protected navigation', async ({ page }) => {
  await login(page, 'first-login');
  await expect(page).toHaveURL(/\/change-password/);
  await page.goto('/rooms');
  await expect(page).toHaveURL(/\/change-password/);
  await page.getByLabel('Current password').fill('browser-private-password');
  await page.getByLabel('New password', { exact: true }).fill('browser-new-private-password');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms$/);
});
test('manager recovery handles invalid codes and completes without automatic login', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Reset manager password' }).click();
  await page.getByLabel('Manager email').fill('manager@example.invalid');
  await page.getByRole('button', { name: 'Send verification code' }).click();
  await page.getByLabel('Email verification code').fill('000000');
  await page.getByLabel('New password', { exact: true }).fill('browser-new-private-password');
  await page.getByLabel('Confirm new password').fill('browser-new-private-password');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The code is invalid' })).toContainText('invalid');
  await page.getByLabel('Email verification code').fill('123456');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Password changed');
  await expect(page).toHaveURL(/reset-password/);
});
test('mobile navigation retains every primary destination and closes with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page).toHaveURL(/analytics/);
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  await toggle.click();
  for (const name of [
    'Analytics',
    'Room status',
    'Food orders',
    'Service requests',
    'Complaints',
    'Promotions',
    'Staff accounts',
    'Worker performance'
  ])
    await expect(page.getByRole('link', { name: new RegExp('^' + name) })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
});
test('login and manager recovery meet automated WCAG 2.1 AA checks', async ({ page }) => {
  for (const path of ['/login', '/reset-password']) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  }
});

test('all eight dashboard sections render with accessible primary navigation', async ({ page }) => {
  test.setTimeout(90000);
  await login(page);
  await expect(page).toHaveURL(/analytics/);
  for (const [path, title] of [
    ['analytics', 'Analytics'],
    ['rooms', 'Room status'],
    ['food-orders', 'Food orders'],
    ['service-requests', 'Service requests'],
    ['complaints', 'Complaints'],
    ['promotions', 'Promotions'],
    ['staff', 'Staff accounts'],
    ['worker-performance', 'Worker Performance']
  ]) {
    await page.goto('/' + path);
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Dashboard', exact: true })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations, `${path} automated accessibility`).toEqual([]);
  }
});
test('staff actions use an accessible confirmation dialog and Escape preserves the account', async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/analytics/);
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Actions for Test Worker' }).click();
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('invalidates existing sessions');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Actions for Test Worker' })).toBeFocused();
});

test('analytics exports complete CSV and PDF downloads with safe filenames', async ({ page }) => {
  await page.route('**/api/reports/bookings?**', route => {
    const format = new URL(route.request().url()).searchParams.get('format');
    const body = format === 'pdf' ? '%PDF-1.4\n%%EOF' : '"Date","Bookings"\r\n"2026-10-26","4"\r\n';
    return route.fulfill({
      status: 200,
      headers: {
        'content-type': format === 'pdf' ? 'application/pdf' : 'text/csv',
        'content-length': String(body.length),
        'content-disposition': `attachment; filename="bookings-2026-10-26.${format}"`
      },
      body
    });
  });
  await login(page);
  await expect(page).toHaveURL(/analytics/);
  for (const format of ['CSV', 'PDF']) {
    const result = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export ' + format, exact: true }).click();
    const file = await result;
    expect(file.suggestedFilename()).toBe('bookings-2026-10-26.' + format.toLowerCase());
    expect(await file.failure()).toBeNull();
  }
});
