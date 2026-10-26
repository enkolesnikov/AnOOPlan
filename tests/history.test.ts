import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_WINDOW_MS, HISTORY_LIMIT, canCoalesce, pushLimited } from '../src/ui/history';

test('история: лимит шагов и отбрасывание самых старых', () => {
  const items = Array.from({ length: HISTORY_LIMIT }, (_, index) => index);
  const next = pushLimited(items, 999);
  assert.equal(next.length, HISTORY_LIMIT);
  assert.equal(next[0], 1);
  assert.equal(next.at(-1), 999);
});

test('история: склейка только одинаковой подписи внутри окна', () => {
  const previous = { label: 'Правка поля', at: 1_000 };
  assert.equal(canCoalesce(previous, 'Правка поля', 1_000 + GROUP_WINDOW_MS - 1), true);
  assert.equal(canCoalesce(previous, 'Правка поля', 1_000 + GROUP_WINDOW_MS), false);
  assert.equal(canCoalesce(previous, 'Перемещение', 1_100), false);
  assert.equal(canCoalesce(previous, undefined, 1_100), false);
  assert.equal(canCoalesce(null, 'Правка поля', 1_100), false);
});
