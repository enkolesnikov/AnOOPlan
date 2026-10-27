import { test, expect } from '@playwright/test';

test('UX: фокус шторки, Escape и Android Back', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const trigger = page.locator('.export-trigger');
  await trigger.click();
  const sheet = page.locator('.sheet[aria-label="Экспорт и копия"]');
  await expect(sheet).toHaveAttribute('aria-modal', 'true');
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.sheet')))).toBe(true);
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.sheet')))).toBe(true);
  }
  expect(await page.evaluate(() => (window as Window & { __anooplanHandleBack?: () => boolean }).__anooplanHandleBack?.())).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => (window as Window & { __anooplanHandleBack?: () => boolean }).__anooplanHandleBack?.())).toBe(false);
});

test('UX: мобильные 4+«Ещё» и выбор инструмента за два касания', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Меню' }).click();
  await page.getByRole('button', { name: 'Учебный проект' }).click();
  const more = page.getByRole('button', { name: /Ещё инструменты/ });
  await expect(more).toBeVisible();
  await more.click();
  const tools = page.locator('.tool-sheet');
  await expect(tools).toBeVisible();
  await page.getByRole('button', { name: 'Кабель' }).click();
  await expect(tools).toBeHidden();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
});
