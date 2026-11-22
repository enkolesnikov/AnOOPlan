import { test, expect } from '@playwright/test';

test('2.8.0: Medeo Sans подключён, двойной клик по сегменту вставляет вершину', async ({ page }) => {
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
  const font = await page.evaluate(() => ({
    check: document.fonts.check('16px "Medeo Sans"'),
    family: getComputedStyle(document.body).fontFamily,
  }));
  expect(font.check).toBe(true);
  expect(font.family).toContain('Medeo Sans');

  await page.getByRole('button', { name: 'Учебный проект' }).first().click();
  // Двухстраничная демо-подложка декодируется дольше: ждём, пока план станет интерактивным.
  await page.waitForTimeout(1200);
  const segments = page.locator('g[data-object="segment"]');
  const before = await segments.count();
  expect(before).toBeGreaterThan(2);
  // Берём вертикальный сегмент Т1.4: центр первого (горизонтального) перекрыт
  // легендой плана, и двойной клик по нему попадает в подпись, а не в линию.
  const box = await segments.nth(3).boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(segments).toHaveCount(before + 1);
  await page.keyboard.press('Control+z');
  await expect(segments).toHaveCount(before);
});
