/**
 * Денежные примитивы сметы и спецификации КНС: шаги округления и чистая
 * арифметика. Вынесены из `estimate.ts` в отдельный модуль без импортов,
 * потому что `estimate.ts` уже импортирует `resolveTrayPrice` из
 * `engine/specification.ts`; если бы спецификация брала `roundMoney` из
 * `estimate.ts`, получился бы цикл импортов. Здесь же нет ни одного импорта,
 * поэтому модуль безопасно подключать с любой стороны.
 */

/** Допустимые правила округления денег, ₽: копейка, рубль, десяток, сотня. */
export const ROUNDING_STEPS = [0.01, 1, 10, 100] as const;

/** Правило округления денег из проекта: одно из 0.01/1/10/100 или null (без округления). */
export function normalizeRounding(value: unknown): number | null {
  return typeof value === 'number' && (ROUNDING_STEPS as readonly number[]).includes(value) ? value : null;
}

/**
 * Округление денежного значения до шага (0.01, 1, 10 или 100 ₽).
 * `null` — значение без изменений; иначе `Math.round(value / rounding) * rounding`.
 */
export function roundMoney(value: number, rounding: number | null): number {
  if (rounding === null) return value;
  const steps = value / rounding;
  // Двоичное представление делает ровную половину шага чуть меньше
  // (1,005 ₽ → 100,4999… копейки), и Math.round уводит её вниз. Сдвиг на
  // несколько ULP возвращает ожидаемое человеком десятичное округление.
  const shifted = steps + Math.abs(steps) * Number.EPSILON * 4;
  return Math.round(shifted) * rounding;
}
