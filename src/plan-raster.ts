import { PLAN_MAX_PIXELS } from './render-plan';

/**
 * Ширина растра плана в PDF. 1 единица PDF = 1/72", поэтому 150 dpi даёт
 * sheetWidth / 72 * 150 пикселей. Сверху ограничиваем половиной бюджета памяти:
 * в capturePage одновременно живут два canvas (лист и слой страницы).
 */
export function planRasterWidth(sheetWidth: number, sheetHeight: number, dpi = 150): number {
  // 1600 px — комфортный минимум; у экстремально вытянутого листа он сам
  // превышает бюджет памяти — тогда ширина ограничена бюджетом.
  const desired = Math.max(1600, Math.round(Math.max(1, sheetWidth) / 72 * dpi));
  const ratio = Math.max(1, sheetHeight) / Math.max(1, sheetWidth);
  // Сумма высот двух канвасов той же ширины: лист и слой PDF.
  return limitPlanRaster(desired, desired * 2 * ratio).width;
}

/** Итоговые размеры канвы после ограничения бюджетом памяти. */
export interface PlanRasterBudget {
  width: number;
  height: number;
  /** true — ширину пришлось уменьшить, вызывающий добавляет предупреждение. */
  limited: boolean;
}

/**
 * Прижимает растр плана к бюджету памяти: при экстремальном соотношении сторон
 * `planRasterWidth` уже не спасает, потому что высота считается от ширины листа.
 * Для двух канвасов (лист и слой PDF) вызывающий передаёт сумму их высот.
 * Уменьшается именно ширина: высота пропорциональна ей, поэтому так сохраняются
 * пропорции листа и бюджет соблюдается с запасом на округление.
 */
export function limitPlanRaster(width: number, height: number, maxPixels: number = PLAN_MAX_PIXELS): PlanRasterBudget {
  const startWidth = Math.max(1, Math.floor(width));
  // ceil: консервативная оценка площади, чтобы округление вверх не пробило бюджет.
  const startHeight = Math.max(1, Math.ceil(height));
  const budget = Math.max(1, maxPixels);
  if (startWidth * startHeight <= budget) return { width: startWidth, height: startHeight, limited: false };
  const reduced = Math.max(1, Math.floor(Math.sqrt(budget * startWidth / startHeight)));
  // floor по высоте гарантирует, что произведение не превысит бюджет.
  const reducedHeight = Math.max(1, Math.floor(reduced * startHeight / startWidth));
  return { width: Math.min(startWidth, reduced), height: reducedHeight, limited: true };
}

/** Предупреждение о том, что план этажа уменьшен по бюджету памяти (null — уменьшать не пришлось). */
export function planRasterWarning(floorName: string, width: number, limited: boolean): string | null {
  if (!limited) return null;
  return `План этажа «${floorName}» уменьшен до ${Math.max(1, Math.floor(width))} px по бюджету памяти.`;
}
