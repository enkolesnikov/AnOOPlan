import { test, expect } from '@playwright/test';

test('2.8.4: удаление внутренней вершины и разворот трассы', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Учебный проект' }).first().click();
  await page.waitForTimeout(500);

  const segments = page.locator('g[data-object="segment"]');
  const box = await segments.first().boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  const before = await segments.count();
  const vertices = page.locator('circle[data-object="vertex"]');
  expect(await vertices.count()).toBeGreaterThan(2);
  const middle = await vertices.nth(1).boundingBox();
  expect(middle).not.toBeNull();
  await page.mouse.dblclick(middle!.x + middle!.width / 2, middle!.y + middle!.height / 2);
  await expect(segments).toHaveCount(before - 1);
  await expect(page.locator('.statusbar')).toContainText('Вершина удалена');
  await page.keyboard.press('Control+z');
  await expect(segments).toHaveCount(before);
  const again = await segments.first().boundingBox();
  await page.mouse.click(again!.x + again!.width / 2, again!.y + again!.height / 2);

  await page.getByRole('button', { name: '↔ Развернуть трассу' }).click();
  await expect(page.locator('.statusbar')).toContainText('развёрнута');
});
