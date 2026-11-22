import test from 'node:test';
import assert from 'node:assert/strict';
import { nonNegativeOrNull, workLineTotal, workLinesWord } from '../src/ui/estimate-screen';

/**
 * Чистые помощники экрана сметы: разбор числовых полей строк работ и сумма
 * с округлением. Поведение интерфейса проверяет смоук (scripts/smoke-dom.mjs).
 */

test('пустое и мусорное значение строки работ — null, а не 0', () => {
  assert.equal(nonNegativeOrNull(''), null);
  assert.equal(nonNegativeOrNull('   '), null);
  assert.equal(nonNegativeOrNull('abc'), null);
  assert.equal(nonNegativeOrNull('-3'), null);
  assert.equal(nonNegativeOrNull('0'), 0);
  assert.equal(nonNegativeOrNull('12,5'), 12.5);
  assert.equal(nonNegativeOrNull(' 7 '), 7);
});

test('сумма строки работ: количество × цена с округлением сметы', () => {
  const work = { quantity: 3, price: 100.5 };
  assert.equal(workLineTotal(work, null), 301.5);
  assert.equal(workLineTotal(work, 1), 302);
  assert.equal(workLineTotal(work, 10), 300);
  // Ноль — известное значение, а не «неизвестно»: он остаётся нулём.
  assert.equal(workLineTotal({ quantity: 0, price: 100 }, null), 0);
  assert.equal(workLineTotal({ quantity: null, price: 100 }, null), null);
  assert.equal(workLineTotal({ quantity: 2, price: null }, null), null);
});

test('склонение «строка» по числу', () => {
  assert.equal(workLinesWord(0), 'строк');
  assert.equal(workLinesWord(1), 'строка');
  assert.equal(workLinesWord(2), 'строки');
  assert.equal(workLinesWord(5), 'строк');
  assert.equal(workLinesWord(11), 'строк');
  assert.equal(workLinesWord(21), 'строка');
  assert.equal(workLinesWord(22), 'строки');
  assert.equal(workLinesWord(25), 'строк');
});
