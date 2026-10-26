import { test, expect } from '@playwright/test';

test('2.7.0: шаблон, комплект, импорт справочника и обучение', async ({ page }) => {
  page.on('dialog', async dialog => {
    if (dialog.type() === 'prompt') await dialog.accept('Мой шаблон');
    else await dialog.accept();
  });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Шаблон «Офис» создаёт готовый проект.
  await page.getByRole('button', { name: 'Новый', exact: true }).click();
  await expect(page.locator('.template-modal')).toBeVisible();
  await page.locator('.template-option', { hasText: 'Офис' }).click();
  await expect(page.getByLabel('Название проекта')).toHaveValue('Офис');
  await expect(page.locator('.statusbar')).toContainText('7 оборуд.');

  // Сохраняем текущий проект как шаблон.
  await page.getByRole('button', { name: 'Новый', exact: true }).click();
  await page.getByRole('button', { name: '＋ Сохранить текущий как шаблон' }).click();
  await expect(page.locator('.template-option', { hasText: 'Мой шаблон' })).toBeVisible();
  await page.locator('.template-modal button[aria-label="Закрыть"]').click();

  // Комплект оборудования вставляется одним действием и отменяется одним шагом.
  await page.getByRole('button', { name: /^Оборуд\./ }).click();
  const rows = page.locator('button.object-row[data-kind="equipment"]');
  const before = await rows.count();
  await page.selectOption('select[aria-label="Комплект оборудования"]', 'security');
  await page.getByRole('button', { name: '＋ Комплект' }).click();
  await expect(rows).toHaveCount(before + 3);
  await page.keyboard.press('Control+z');
  await expect(rows).toHaveCount(before);

  // Импорт CSV в справочник: предпросмотр, серия/размер, подтверждение.
  await page.getByRole('button', { name: 'Смета', exact: true }).click();
  await page.locator('.catalog-editor summary').click();
  await page.locator('.catalog-import-table-input').setInputFiles({
    name: 'price.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Вид,Наименование,Серия,Размер,Ед.,Цена\nОборудование,Тестовая камера,Test,1×1,шт,1234,5\n', 'utf8'),
  });
  await expect(page.locator('.catalog-preview')).toBeVisible();
  await expect(page.locator('.catalog-preview')).toContainText('Тестовая камера');
  await page.getByRole('button', { name: /Импортировать \(/ }).click();
  await expect(page.locator('.catalog-series input').last()).toHaveValue('Test');
  await expect(page.locator('.statusbar')).toContainText('добавлено 1');

  // Обучение доступно из меню и доводит до демо-проекта.
  await page.getByRole('button', { name: '🎓 Обучение' }).click();
  await expect(page.locator('.onboarding-modal')).toBeVisible();
  for (let index = 0; index < 4; index += 1) await page.getByRole('button', { name: 'Далее →' }).click();
  await page.getByRole('button', { name: 'Открыть учебный проект' }).click();
  await expect(page.getByLabel('Название проекта')).toHaveValue('Учебный проект');
});
