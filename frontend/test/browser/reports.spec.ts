import { test, expect } from '@playwright/test';
test.setTimeout(90000);
async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('manager');
  await page.getByLabel('Password', { exact: true }).fill('contract-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/analytics$/);
}
test('TC-MAD-031-AC3: real database Reports index CSV/PDF and empty filtered export', async ({
  page,
}) => {
  await login(page);
  await page.goto('/reports');
  const csvPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).focus();
  await page.keyboard.press('Enter');
  const csv = await csvPending;
  expect(csv.suggestedFilename()).toMatch(/^bookings-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(await csv.failure()).toBeNull();
  const csvStream = await csv.createReadStream();
  let text = '';
  for await (const chunk of csvStream!) text += chunk.toString();
  expect(text).toContain('"total","1","count"');
  await page
    .getByLabel('Report', { exact: true })
    .selectOption('worker-performance');
  await page
    .getByLabel('Worker ID (optional)')
    .fill('77f4568c-89ab-4c12-b321-123456789012');
  const emptyPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const empty = await emptyPending;
  let body = '';
  for await (const chunk of (await empty.createReadStream())!)
    body += chunk.toString();
  expect(body).toContain('"workers","[]","empty"');
  const pdfPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  const pdf = await pdfPending;
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  expect(await pdf.failure()).toBeNull();
});
test('TC-MAD-031-AC1: per-view exports retain real period/occupancy filters', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  const booking = page.getByRole('group', {
    name: 'bookings report downloads',
    exact: true,
  });
  await expect(booking).toBeVisible();
  const outgoing = page.waitForRequest((r) =>
    r.url().includes('/api/reports/bookings'),
  );
  const downloaded = page.waitForEvent('download');
  await booking.getByRole('button', { name: 'Export CSV' }).click();
  expect((await outgoing).url()).toContain('period=month');
  await downloaded;
  await page.goto('/food-orders');
  await expect(
    page.getByRole('table', { name: 'Top ordered items' }),
  ).toContainText('Soup');
  await page.goto('/service-requests');
  await expect(page.getByText('60 min', { exact: true })).toBeVisible();
  await page.goto('/worker-performance');
  await expect(
    page.getByRole('table', {
      name: 'Worker performance in minutes, current filters',
    }),
  ).toContainText('Fixture Staff');
});
