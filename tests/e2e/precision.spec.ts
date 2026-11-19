import { test, expect } from '@playwright/test';
import { cellText, documentSection, lastCellText, openDemoProject, openView } from './precision-helpers';

test('2.9.1 C-07: смета оценивает каждое сечение КНС отдельной строкой', async ({ page }) => {
  await openDemoProject(page);
  await openView(page, 'Смета');

  const trays = documentSection(page, 'Лотки');
  const lotok = trays.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Лоток · 100×50', exact: true }) });
  const stojak = trays.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Стояк · 50×50', exact: true }) });

  // Два сечения одного раздела — две строки, а не одна общая «Лоток».
  await expect(lotok).toHaveCount(1);
  await expect(stojak).toHaveCount(1);
  await expect(trays.getByRole('cell', { name: 'Лоток', exact: true })).toHaveCount(0);

  // Демо: 55 м лотка по 480 ₽ и 4 м стояка по 620 ₽ — цена берётся по сечению.
  expect(await cellText(lotok, 2)).toBe('55');
  expect(await cellText(lotok, 3)).toBe('480₽');
  expect(await cellText(lotok, 4)).toBe('26400₽');
  expect(await cellText(lotok, 5)).toBe('справочник');
  expect(await cellText(stojak, 2)).toBe('4');
  expect(await cellText(stojak, 3)).toBe('620₽');
  expect(await cellText(stojak, 4)).toBe('2480₽');
  expect(await cellText(stojak, 5)).toBe('справочник');

  // Строки не слиты: количества, цены и суммы различаются.
  expect(await cellText(lotok, 2)).not.toBe(await cellText(stojak, 2));
  expect(await cellText(lotok, 3)).not.toBe(await cellText(stojak, 3));
  expect(await cellText(lotok, 4)).not.toBe(await cellText(stojak, 4));
  await expect(trays.getByText('не рассчитано')).toHaveCount(0);
});

test('2.9.1 C-07: чужое сечение не подменяется первой ценой — прочерк и предупреждение', async ({ page }) => {
  await openDemoProject(page);
  await openView(page, 'Смета');

  // Оставляем у «Стояк» чужой размер: сечения 50×50 в справочнике больше нет.
  await page.locator('summary').filter({ hasText: /^Справочник цен/ }).click();
  // Позицию ищем по кнопке удаления: значение input не входит в текст строки.
  const catalogRow = page.getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'Удалить позицию Стояк' }) });
  await expect(catalogRow).toHaveCount(1);
  await catalogRow.getByLabel(/^Размер позиции/).fill('999×999');

  const trays = documentSection(page, 'Лотки');
  const stojak = trays.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Стояк · 50×50', exact: true }) });
  await expect(stojak).toHaveCount(1);

  // Цена «—» и сумма «—»: ни своя 620 ₽, ни первая попавшаяся 480 ₽ не подставляются.
  expect(await cellText(stojak, 3)).toBe('—');
  expect(await cellText(stojak, 4)).toBe('—');
  const stojakText = await stojak.innerText();
  expect(stojakText).not.toContain('620');
  expect(stojakText).not.toContain('480');

  // Видимое объяснение, какого именно сечения не хватает.
  await expect(page.getByText('Смета: для «Стояк» нет цены сечения 50×50 в справочнике').first()).toBeVisible();
  await expect(page.getByText('Смета неполная', { exact: true }).first()).toBeVisible();

  // Второе сечение с точной ценой не затронуто.
  const lotok = trays.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Лоток · 100×50', exact: true }) });
  expect(await cellText(lotok, 3)).toBe('480₽');
  expect(await cellText(lotok, 4)).toBe('26400₽');
});

test('2.9.1 C-04: углы Кабель-канала видны и после split не теряются и не задваиваются', async ({ page }) => {
  await openDemoProject(page);

  // Демо-Т1 — единственная трасса «Лоток» с поворотом (3 сегмента + подъём).
  // «Схема трасс» показывает углы только для группы «Кабель-канал», поэтому
  // меняем тип через шаблон КНС, не меняя геометрию.
  const segment = page.locator('g[data-object="segment"]').first();
  const box = await segment.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  const trunkingChip = page.getByRole('button', { name: 'Кабель-канал', exact: true });
  await expect(trunkingChip).toBeVisible();
  await trunkingChip.click();
  await expect(trunkingChip).toHaveAttribute('aria-pressed', 'true');

  const scheme = page.getByRole('table')
    .filter({ has: page.getByRole('columnheader', { name: 'Сечения', exact: true }) })
    .filter({ has: page.getByRole('columnheader', { name: 'Углы', exact: true }) });
  const routeRow = (number: string) => scheme.getByRole('row')
    .filter({ has: page.getByRole('cell', { name: number, exact: true }) });

  await openView(page, 'Ведомости');
  await expect(routeRow('Т1')).toHaveCount(1);
  expect(await lastCellText(routeRow('Т1'))).toBe('1');

  // Второй демо-лоток Т3 (этаж 2) — та же Г-образная геометрия, тоже один угол.
  await openView(page, 'План');
  await page.getByRole('button', { name: /^Трассы/ }).click();
  await page.getByRole('button', { name: /Т3 · Лоток/ }).first().click();
  await expect(trunkingChip).toBeVisible();
  await trunkingChip.click();
  await expect(trunkingChip).toHaveAttribute('aria-pressed', 'true');

  await openView(page, 'Ведомости');
  expect(await lastCellText(routeRow('Т1'))).toBe('1');
  expect(await lastCellText(routeRow('Т3'))).toBe('1');
  const groupTotal = scheme.getByRole('row').filter({ hasText: 'Итого: Кабель-канал' });
  await expect(groupTotal).toHaveCount(1);
  expect(await lastCellText(groupTotal)).toBe('2');

  // Разделяем Т1 по вершине поворота (X 700 · Y 350): угол теперь на стыке трасс.
  await openView(page, 'План');
  await page.getByRole('button', { name: /^Трассы/ }).click();
  await page.getByRole('button', { name: /Т1 · Кабель-канал/ }).first().click();
  await page.getByLabel('Разделить трассу по вершине').selectOption({ index: 3 });
  await expect(page.locator('.statusbar')).toContainText('разделена');

  await openView(page, 'Ведомости');
  await expect(routeRow('Т1')).toHaveCount(1);
  await expect(routeRow('Т1-2')).toHaveCount(1);
  const angles = [
    Number(await lastCellText(routeRow('Т1'))),
    Number(await lastCellText(routeRow('Т1-2'))),
    Number(await lastCellText(routeRow('Т3'))),
  ];
  // Угол на стыке считается один раз: Т1 0, продолжение Т1-2 1, отдельная Т3 1.
  expect(angles).toEqual([0, 1, 1]);
  expect(await lastCellText(groupTotal)).toBe('2');
  expect(angles.reduce((sum, value) => sum + value, 0)).toBe(2);
});
