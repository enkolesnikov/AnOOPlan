import { PLAN_MAX_PIXELS } from './render-plan';

/**
 * Ширина растра плана в PDF. 1 единица PDF = 1/72", поэтому 150 dpi даёт
 * sheetWidth / 72 * 150 пикселей. Сверху ограничиваем половиной бюджета памяти:
 * в capturePage одновременно живут два canvas (лист и слой страницы).
 */
export function planRasterWidth(sheetWidth: number, sheetHeight: number, dpi = 150): number {
  const desired = Math.round(sheetWidth / 72 * dpi);
  const budget = Math.floor(Math.sqrt((PLAN_MAX_PIXELS / 2) * sheetWidth / Math.max(1, sheetHeight)));
  return Math.max(1600, Math.min(desired, budget));
}
