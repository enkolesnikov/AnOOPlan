import { test, expect } from '@playwright/test';
import { PDFDocument, rgb } from 'pdf-lib';
import { readFileSync } from 'node:fs';

/**
 * Регрессия 1.8.3: SVG-оверлей плана не должен закрывать PDF-подложку.
 * Загружаем заметный PDF, экспортируем журнал и проверяем, что в растровом
 * снимке листа «План» есть цвет подложки.
 */
test('PDF-подложка попадает в лист «План» выгруженного журнала', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', dialog => void dialog.accept());

  await page.addInitScript(() => {
    const state = window as Window & { __planBlobs?: string[]; __planError?: string };
    state.__planBlobs = [];
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (this.width === 1600) {
        try { state.__planBlobs!.push(this.toDataURL(type || 'image/png')); }
        catch (error) { state.__planError = String(error); }
      }
      return original.call(this, callback, type, quality);
    };
  });

  await page.goto('/');
  await expect(page.locator('.statusbar')).toContainText('БРАУЗЕР');
  await page.locator('.command-actions button').filter({ hasText: 'Учебный проект' }).click();
  await expect(page.locator('.statusbar')).toContainText('Учебный проект');

  // Пурпурный PDF: цвет легко отличить от трасс (#008e94) и оборудования (#122936).
  const source = await PDFDocument.create();
  const sourcePage = await source.addPage([1000, 700]);
  sourcePage.drawRectangle({ x: 0, y: 0, width: 1000, height: 700, color: rgb(1, 0, 1) });
  sourcePage.drawRectangle({ x: 100, y: 100, width: 300, height: 200, color: rgb(0, 1, 0) });
  const secondPage = await source.addPage([1000, 700]);
  secondPage.drawRectangle({ x: 0, y: 0, width: 1000, height: 700, color: rgb(0, 1, 1) });
  const sourceBytes = Buffer.from(await source.save());

  await page.locator('input[type=file][accept*="pdf"]').setInputFiles({
    name: 'plan.pdf', mimeType: 'application/pdf', buffer: sourceBytes,
  });
  await expect(page.locator('.statusbar')).toContainText('PDF «plan.pdf» загружен');

  // Подложка должна быть не только в экспорте, но и на canvas плана.
  const canvas = await page.locator('canvas').evaluate(element => {
    const canvasElement = element as HTMLCanvasElement;
    const context = canvasElement.getContext('2d')!;
    const data = context.getImageData(0, 0, canvasElement.width, canvasElement.height).data;
    let nonWhite = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] < 240 || data[index + 1] < 240 || data[index + 2] < 240) nonWhite += 1;
    }
    return { width: canvasElement.width, height: canvasElement.height, nonWhite };
  });
  expect(canvas.width).toBeGreaterThan(0);
  expect(canvas.nonWhite).toBeGreaterThan(1000);

  await page.evaluate(() => { (window as Window & { __planBlobs?: string[] }).__planBlobs = []; });
  await page.locator('.export-trigger').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.sheet-list button').filter({ hasText: /^PDF$/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);

  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  const bytes = readFileSync(downloadedPath!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const exported = await PDFDocument.load(bytes);
  expect(exported.getPageCount()).toBeGreaterThanOrEqual(3);

  const result = await page.evaluate(async () => {
    const state = window as Window & { __planBlobs?: string[]; __planError?: string };
    const blobs = state.__planBlobs || [];
    const stats: { width: number; height: number; magenta: number; cyan: number; nonWhite: number }[] = [];
    for (const url of blobs) {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let magenta = 0;
      let cyan = 0;
      let nonWhite = 0;
      for (let index = 0; index < data.length; index += 4) {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        if (red > 200 && blue > 200 && green < 80) magenta += 1;
        if (blue > 200 && green > 200 && red < 80) cyan += 1;
        if (red < 240 || green < 240 || blue < 240) nonWhite += 1;
      }
      stats.push({ width: canvas.width, height: canvas.height, magenta, cyan, nonWhite });
    }
    return { count: blobs.length, stats, error: state.__planError || null };
  });

  expect(result.error).toBeNull();
  expect(result.count).toBeGreaterThanOrEqual(3);
  expect(result.stats.some(item => item.magenta > 100_000)).toBeTruthy();
  expect(result.stats.some(item => item.cyan > 100_000)).toBeTruthy();
  expect(pageErrors).toEqual([]);
});
