import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_WINDOW_MS, canCoalesce } from '../src/ui/history';

/**
 * Склейка шагов undo: именованные действия склеиваются по подписи в окне
 * GROUP_WINDOW_MS, безымянные (label === undefined) — только между собой.
 * Разрыв больше окна всегда начинает новый шаг.
 */

const start = 1_000_000;
const action = (label: string | undefined, at = start) => ({ label, at });

test('canCoalesce: без предыдущего действия новый шаг', () => {
  assert.equal(canCoalesce(null, 'Правка поля', start), false);
  assert.equal(canCoalesce(null, undefined, start), false);
});

test('canCoalesce: безымянные действия склеиваются в окне', () => {
  assert.equal(canCoalesce(action(undefined), undefined, start), true);
  assert.equal(canCoalesce(action(undefined), undefined, start + GROUP_WINDOW_MS - 1), true);
});

test('canCoalesce: безымянное не склеивается с именованным и наоборот', () => {
  assert.equal(canCoalesce(action(undefined), 'Правка поля', start + 10), false);
  assert.equal(canCoalesce(action('Правка поля'), undefined, start + 10), false);
  assert.equal(canCoalesce(action('Действие'), undefined, start + 10), false);
});

test('canCoalesce: одинаковые подписи склеиваются, разные — нет', () => {
  assert.equal(canCoalesce(action('Правка поля'), 'Правка поля', start + 10), true);
  assert.equal(canCoalesce(action('Правка поля'), 'Правка поля', start + GROUP_WINDOW_MS - 1), true);
  assert.equal(canCoalesce(action('Правка поля'), 'Дублирование', start + 10), false);
  assert.equal(canCoalesce(action('Правка поля'), 'правка поля', start + 10), false);
});

test('canCoalesce: на границе окна и после него — новый шаг', () => {
  assert.equal(canCoalesce(action('Правка поля'), 'Правка поля', start + GROUP_WINDOW_MS), false);
  assert.equal(canCoalesce(action('Правка поля'), 'Правка поля', start + GROUP_WINDOW_MS + 1), false);
  assert.equal(canCoalesce(action(undefined), undefined, start + GROUP_WINDOW_MS), false);
  assert.equal(canCoalesce(action(undefined), undefined, start + GROUP_WINDOW_MS + 1), false);
});

test('canCoalesce: своё окно склейки', () => {
  assert.equal(canCoalesce(action(undefined), undefined, start + 100, 101), true);
  assert.equal(canCoalesce(action(undefined), undefined, start + 100, 100), false);
  assert.equal(canCoalesce(action('Поле'), 'Поле', start + 250, 200), false);
});
