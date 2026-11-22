import type { WorkLine } from '../model';
import { roundMoney } from '../estimate';

/**
 * Чистые помощники экрана сметы: разбор числовых полей, сумма строки работ
 * и склонение подписи. Вынесены из `estimate-screen.tsx`, чтобы их можно было
 * покрыть юнит-тестами без React и чтобы сам экран не тянул DOM в тесты.
 */

/** Неотрицательное конечное число из строки, иначе null (пусто/мусор/минус не сохраняются). */
export const nonNegativeOrNull = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/** Сумма строки работ (количество × цена) с округлением сметы; null — значение неизвестно. */
export function workLineTotal(work: Pick<WorkLine, 'quantity' | 'price'>, rounding: number | null): number | null {
  if (work.quantity === null || work.price === null) return null;
  if (!Number.isFinite(work.quantity) || !Number.isFinite(work.price)) return null;
  return roundMoney(work.quantity * work.price, rounding);
}

/** Склонение «строка» по числу: 1 строка, 2 строки, 5 строк. */
export function workLinesWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'строка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'строки';
  return 'строк';
}
