import { expect, test, type Page } from '@playwright/test';

// Визуальные эталоны ключевых экранов. Состояние детерминированное: чистое
// хранилище, учебный проект, фиксированный viewport, анимации отключены.
// Эталоны лежат рядом (*-snapshots) и обновляются: npm run test:visual:update

async function openDemo(page: Page) {
  // Подтверждение «продолжить без сохранения» — нативный confirm браузера.
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Учебный проект' }).click();
  // Демо-проект: 7 оборудования, 3 трассы, 4 кабеля — ждём именно его, а не пустой проект.
  await expect(page.locator('.statusbar')).toContainText('7 оборуд.');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test('план учебного проекта', async ({ page }) => {
  await openDemo(page);
  await expect(page).toHaveScreenshot('plan-demo.png');
});

test('своё сечение на сегменте КНС', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: /^Трассы/ }).click();
  await page.locator('button.object-row[data-kind="route"]').first().click();
  const segment = page.locator('details.segment-editor').nth(1);
  await segment.locator('summary').click();
  await segment.getByLabel('Ширина, мм').fill('200');
  await segment.getByLabel('Высота борта, мм').fill('80');
  await page.waitForTimeout(400);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(page).toHaveScreenshot('segment-override.png');
});

test('тёмная тема плана', async ({ page }) => {
  await openDemo(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.waitForTimeout(400);
  await expect(page).toHaveScreenshot('plan-dark.png');
});

test('схема трасс с сечениями', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: /^Трассы/ }).click();
  await page.locator('button.object-row[data-kind="route"]').first().click();
  const segment = page.locator('details.segment-editor').nth(1);
  await segment.locator('summary').click();
  await segment.getByLabel('Ширина, мм').fill('200');
  await page.getByRole('button', { name: 'Ведомости' }).click();
  await page.waitForTimeout(400);
  const scheme = page.locator('.spec-section', { hasText: 'Схема трасс' }).first();
  await scheme.scrollIntoViewIfNeeded();
  await expect(scheme).toHaveScreenshot('route-scheme.png');
});
