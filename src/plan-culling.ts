import type { Point } from './model';

/**
 * Отсечение объектов плана по видимой области (3.0.0).
 *
 * До 3.0.0 SVG-оверлей рисовал все сегменты, оборудование, пины и размеры
 * независимо от масштаба: на большом проекте (1000+ объектов) это давало
 * ~10 тыс. DOM-узлов и фризы при каждом вводе. Теперь видимые элементы
 * вычисляются из положения камеры: лист трансформируется
 * `translate(pan) scale(zoom)`, поэтому видимый прямоугольник в координатах
 * листа — это вьюпорт, делённый на zoom и сдвинутый на pan.
 *
 * Интерактивные элементы (черновик трассы, калибровка, рулетка, выбранные
 * объекты) отсечению не подлежат — это решает вызывающий код.
 */

export interface ViewportRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Видимый прямоугольник листа. `margin` — запас в единицах листа, чтобы
 * объекты не «мигали» на границе при мелкой панораме.
 * null — размеры вьюпорта неизвестны (первый кадр): рендерить всё.
 */
export function visibleFloorRect(
  pan: Point,
  zoom: number,
  viewWidth: number,
  viewHeight: number,
  margin = 0,
): ViewportRect | null {
  if (!Number.isFinite(zoom) || zoom <= 0) return null;
  if (!Number.isFinite(viewWidth) || !Number.isFinite(viewHeight) || viewWidth <= 0 || viewHeight <= 0) return null;
  const x0 = -pan.x / zoom - margin;
  const y0 = -pan.y / zoom - margin;
  return {
    x0,
    y0,
    x1: (-pan.x + viewWidth) / zoom + margin,
    y1: (-pan.y + viewHeight) / zoom + margin,
  };
}

/** Точка внутри видимого прямоугольника (с допуском на размер символа). */
export function pointVisible(rect: ViewportRect, x: number, y: number, pad = 0): boolean {
  return x >= rect.x0 - pad && x <= rect.x1 + pad && y >= rect.y0 - pad && y <= rect.y1 + pad;
}

/** Отрезок пересекает видимый прямоугольник (по ограничивающей рамке). */
export function segmentVisible(rect: ViewportRect, ax: number, ay: number, bx: number, by: number, pad = 0): boolean {
  const x0 = Math.min(ax, bx) - pad;
  const x1 = Math.max(ax, bx) + pad;
  const y0 = Math.min(ay, by) - pad;
  const y1 = Math.max(ay, by) + pad;
  return x1 >= rect.x0 && x0 <= rect.x1 && y1 >= rect.y0 && y0 <= rect.y1;
}
