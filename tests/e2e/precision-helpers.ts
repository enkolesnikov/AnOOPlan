import { expect, type Locator, type Page } from '@playwright/test';

/** Чистый учебный проект: тот же вход, что и в остальных e2e-сценариях. */
export async function openDemoProject(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Учебный проект' }).first().click();
  await page.waitForTimeout(600);
}

/** Переход по вкладке экрана («План», «Журнал», «Ведомости», «Смета»). */
export async function openView(page: Page, name: 'План' | 'Журнал' | 'Ведомости' | 'Смета'): Promise<void> {
  const tab = page.getByRole('button', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-current', 'page');
}

/** Раздел документа по его заголовку (смета, ведомость). */
export function documentSection(page: Page, title: string): Locator {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

/** Текст ячейки без пробелов: «26 400 ₽» → «26400₽» (ru-RU разделяет разряды NBSP). */
export async function cellText(row: Locator, index: number): Promise<string> {
  return (await row.getByRole('cell').nth(index).innerText()).replace(/\s/g, '');
}

/** Текст последней ячейки строки: в «Схеме трасс» это «Углы». */
export async function lastCellText(row: Locator): Promise<string> {
  return (await row.getByRole('cell').last().innerText()).replace(/\s/g, '');
}
