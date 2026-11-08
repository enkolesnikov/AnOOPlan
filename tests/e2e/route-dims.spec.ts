import { test, expect } from '@playwright/test';

test('2.8.5: разделение/объединение трассы и цепочка размеров', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Учебный проект' }).first().click();
  await page.waitForTimeout(600);

  // Выбрать трассу кликом по первому сегменту.
  const segment = page.locator('g[data-object="segment"]').first();
  const box = await segment.boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page.locator('.svg-label').first()).toContainText('Т1.1');
  await expect(page.locator('.svg-label').first()).toContainText('м');

  // Разделить по внутренней вершине.
  await page.getByLabel('Разделить трассу по вершине').selectOption({ index: 1 });
  await expect(page.locator('.statusbar')).toContainText('разделена');
  const routesAfterSplit = await page.getByRole('button', { name: /^Трассы/ }).textContent();
  expect(routesAfterSplit).toContain('4');

  // Объединить обратно со второй частью.
  await page.getByLabel('Объединить трассу').selectOption({ index: 3 });
  await expect(page.locator('.statusbar')).toContainText('объединены');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');

  // Цепочка размеров: три оборудования → два размера, один undo.
  await page.getByRole('button', { name: 'Размер', exact: true }).click();
  await page.getByRole('button', { name: 'Цепочка' }).click();
  const equipment = page.locator('g[data-object="equipment"]');
  for (let index = 0; index < 3; index += 1) {
    const item = await equipment.nth(index).boundingBox();
    await page.mouse.click(item!.x + item!.width / 2, item!.y + item!.height / 2);
  }
  await page.getByRole('button', { name: /Завершить/ }).click();
  await expect(page.locator('.statusbar')).toContainText('Цепочка размеров: 2');
  await expect(page.locator('g[data-object="dimension"]')).toHaveCount(2);
});
