import type { Point } from '../model';

/** Число в русской локали; null/undefined/NaN — «—», а не 0. */
export const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ru-RU', { maximumFractionDigits: 3 }) : '—';
// Статусы заполнения приходят из движка английскими ключами — в интерфейсе показываем по-русски.
export const FILL_STATUS_LABELS: Record<string, string> = { ok: 'ок', warning: 'внимание', over: 'превышено', empty: 'пусто', incomplete: 'неполный' };
export const fillStatus = (status: string | null | undefined): string => (status ? FILL_STATUS_LABELS[status] ?? status : '');
export const fillPercentText = (value: number | null | undefined): string => typeof value === 'number' && Number.isFinite(value) ? `${number(value)} %` : 'не рассчитано';
export const trayFillText = (value: number | null | undefined, status?: string | null): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'не рассчитано';
  const suffix = fillStatus(status);
  return `${number(value)} %${suffix ? ` · ${suffix}` : ''}`;
};
export const areaMm2Text = (value: number | null | undefined): string => typeof value === 'number' && Number.isFinite(value) ? `${number(value)} мм²` : 'не рассчитано';

/** Площадь многоугольника в единицах плана. */
export function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index], b = points[(index + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Площадь контура в метрах по масштабу этажа или в единицах PDF. */
export function areaLabel(points: Point[], metersPerUnit: number | null | undefined): string {
  const units = polygonArea(points);
  const scale = metersPerUnit;
  return scale && scale > 0 ? `${number(units * scale * scale)} м²` : `${number(units)} ед.²`;
}
