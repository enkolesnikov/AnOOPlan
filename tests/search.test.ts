import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesQuery, normalizeQuery, searchCaption } from '../src/ui/search';

test('поиск: пустой запрос совпадает со всем', () => {
  assert.equal(matchesQuery('', ['К1', 'Камера']), true);
  assert.equal(matchesQuery('   ', ['К1']), true);
});

test('поиск: регистр и несколько токенов по разным полям', () => {
  const fields = ['Т1', 'Лоток', 'Горизонтальная трасса этажа 1'];
  assert.equal(matchesQuery('лоток', fields), true);
  assert.equal(matchesQuery('Т1 ГОРИЗ', fields), true);
  assert.equal(matchesQuery('Т1 труба', fields), false);
  assert.equal(matchesQuery('этажа', fields), true);
});

test('поиск: токен не должен собираться из разных полей', () => {
  // «Т1лоток» нет ни в одном поле, склейка не должна давать ложное совпадение.
  assert.equal(matchesQuery('Т1лоток', ['Т1', 'Лоток']), false);
});

test('поиск: нормализация и подпись результата', () => {
  assert.deepEqual(normalizeQuery('  К1   Камера '), ['к1', 'камера']);
  assert.equal(searchCaption('', 0, 5), '');
  assert.equal(searchCaption('к1', 1, 5), 'Найдено: 1 из 5');
});
