import { expect, test } from '@playwright/test';
async function login(
  page: import('@playwright/test').Page,
  username = 'manager',
) {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill('contract-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
test('direct URL protection, intended destination, HttpOnly session and logout', async ({
  page,
  context,
}) => {
  const logs: string[] = [];
  page.on('console', (message) => logs.push(message.text()));
  await page.goto('/rooms');
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await login(page);
  await expect(page).toHaveURL(/\/rooms$/);
  await expect(
    page.getByRole('navigation', { name: 'Dashboard' }),
  ).toBeVisible();
  const cookie = (await context.cookies()).find(
    (item) => item.name === 'mad_session',
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Strict');
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    'mad_session',
  );
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
  expect(logs.join(' ')).not.toContain('contract-password');
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/rooms');
  await expect(page).toHaveURL(/\/login/);
});
test('wrong credentials do not open the dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('manager');
  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to sign in');
  await expect(page).toHaveURL(/\/login$/);
});
test('first-login password change must finish before dashboard access', async ({
  page,
}) => {
  await page.goto('/login');
  await login(page, 'first-login');
  await expect(page).toHaveURL(/\/change-password/);
  await page.goto('/rooms');
  await expect(page).toHaveURL(/\/change-password/);
  await page.getByLabel('Current password').fill('contract-password');
  await page.getByLabel('New password').fill('replacement-password');
  await page
    .getByRole('button', { name: 'Change password', exact: true })
    .click();
  await expect(page).toHaveURL(/\/rooms$/);
});
test('mobile and keyboard navigation keep all destinations reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/login');
  await login(page);
  await expect(page).toHaveURL(/\/analytics$/);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  for (const name of [
    'Analytics',
    'Room status',
    'Promotions',
    'Staff accounts',
    'Notifications',
    'Complaints',
    'Food orders',
    'Service requests',
    'Worker performance',
    'Tasks',
    'Reports',
    'Settings',
  ])
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  const settings = page.getByRole('link', { name: 'Settings', exact: true });
  await settings.focus();
  await expect(settings).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    page.getByRole('button', { name: 'Open navigation' }),
  ).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
test('expired or tampered session never returns protected content', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await login(page);
  await expect(page).toHaveURL(/\/analytics$/);
  await context.addCookies([
    { name: 'mad_session', value: 'tampered', domain: '127.0.0.1', path: '/' },
  ]);
  await page.goto('/reports');
  await expect(page).toHaveURL(/\/login.*reason=expired/);
  await expect(page.getByRole('heading', { name: 'Reports' })).toHaveCount(0);
});
