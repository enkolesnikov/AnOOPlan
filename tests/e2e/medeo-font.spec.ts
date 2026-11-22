import { test, expect } from '@playwright/test';

test('2.8.0: Medeo Sans подключён, двойной клик по сегменту вставляет вершину', async ({ page }) => {
  // План должен быть виден целиком: на 1280×720 нижняя панель перекрывает
  // середину длинного сегмента, и двойной клик попадает в панель.
  await page.setViewportSize({ width: 1280, height: 900 });
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
  await page.waitForTimeout(500);
  const segments = page.locator('g[data-object="segment"]');
  const before = await segments.count();
  expect(before).toBeGreaterThan(2);
  // Двойной клик — по самому длинному сегменту: у коротких середина может попасть
  // в иконку оборудования, и вставка вершины не сработает. locator.dblclick сам
  // прокручивает план к элементу.
  const longest = await segments.evaluateAll(nodes => {
    const lengths = nodes.map(node => {
      const box = node.getBoundingClientRect();
      return Math.max(box.width, box.height);
    });
    return lengths.indexOf(Math.max(...lengths));
  });
  await segments.nth(longest).dblclick({ force: true });
  await expect(segments).toHaveCount(before + 1);
  await page.keyboard.press('Control+z');
  await expect(segments).toHaveCount(before);
});
