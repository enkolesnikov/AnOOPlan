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
 * `null` — значение без изменений; `Math.round(value / rounding) * rounding`.
 */
export function roundMoney(value: number, rounding: number | null): number {
  return rounding === null ? value : Math.round(value / rounding) * rounding;
}
