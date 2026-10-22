import { expect, test, type Page } from '@playwright/test';
import axe from 'axe-core';

async function scan(page: Page) {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const engine = (window as unknown as Window & { axe: typeof axe }).axe;
    const result = await engine.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
      },
    });
    return result.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map((node) => node.target),
    }));
  });
  expect(violations).toEqual([]);
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('manager');
  await page.getByLabel('Password', { exact: true }).fill('contract-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/analytics$/);
}

test('TC-MAD-048-AC1: login WCAG 2.1 A/AA automated scan', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Username')).toBeVisible();
  await scan(page);
});

test('TC-MAD-048-AC1: mandatory password-change form accessibility', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('first-login');
  await page.getByLabel('Password', { exact: true }).fill('contract-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/change-password/);
  await expect(page.getByLabel('New password')).toBeVisible();
  await scan(page);
});

for (const route of [
  'analytics',
  'rooms',
  'food-orders',
  'service-requests',
  'complaints',
  'promotions',
  'staff',
  'worker-performance',
  'notifications',
  'tasks',
  'reports',
  'settings',
]) {
  test(`TC-MAD-048-AC1/AC2: ${route} WCAG 2.1 A/AA scan`, async ({ page }) => {
    test.setTimeout(60000);
    await login(page);
    await page.goto('/' + route);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByText(/^Loading\b/)).toHaveCount(0);
    await scan(page);
  });
}

test('TC-MAD-048-AC1: keyboard navigation wraps, escapes and restores focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  const toggle = page.getByRole('button', { name: 'Open navigation' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('link', { name: 'Analytics', exact: true }),
  ).toBeFocused();
  await expect(page.locator('#dashboard-content')).toHaveAttribute('inert', '');
  await page.getByRole('button', { name: 'Logout', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Close navigation' }),
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    page.getByRole('button', { name: 'Logout', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await expect(page.locator('#dashboard-content')).not.toHaveAttribute('inert');
  const outline = await toggle.evaluate(
    (node) => getComputedStyle(node).outlineStyle,
  );
  expect(outline).not.toBe('none');
});

for (const width of [320, 768, 1280]) {
  test(`TC-MAD-048-AC3: controls reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await page.goto('/reports');
    const report = page.getByRole('combobox', { name: /^Report\b/ });
    await expect(report).toBeVisible();
    await report.focus();
    await expect(report).toBeFocused();
    const pdf = page.getByRole('button', { name: 'Export PDF', exact: true });
    await pdf.focus();
    await expect(pdf).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await scan(page);
  });
}
