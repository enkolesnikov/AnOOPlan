import test from 'node:test';
import assert from 'node:assert/strict';
import { structureCounts } from '../src/ui/sidebar-counts';
import { searchCaption } from '../src/ui/search';
import { baseProject, cable } from './fixtures';

/**
 * Счётчики вкладок сайдбара считают все объекты проекта, а не выбранный
 * этаж или отфильтрованный поиском список. Именно поэтому «Кабели» на
 * вкладке «План» и строки «Журнала» показывают одно и то же число.
 */

test('structureCounts: все объекты проекта независимо от этажа', () => {
  // Четыре кабеля проекта, но только три начинаются на этаже 1:
  // счётчик обязан показать 4 — как и строк в журнале.
  const project = baseProject({
    equipment: [
      ...baseProject().equipment,
      { ...baseProject().equipment[0], id: 'c', number: 'C', floorId: 'f2' },
    ],
    cables: [
      cable({ id: 'c1', fromId: 'a' }),
      cable({ id: 'c2', fromId: 'a' }),
      cable({ id: 'c3', fromId: 'b' }),
      cable({ id: 'c4', fromId: 'c' }),
    ],
  });
  assert.deepEqual(structureCounts(project), {
    floors: 2,
    equipment: 3,
    routes: 1,
    cables: 4,
    pins: 0,
  });
});

test('structureCounts: пустой проект даёт нули', () => {
  const empty = baseProject({ floors: [], equipment: [], routes: [], cables: [], pins: [] });
  assert.deepEqual(structureCounts(empty), { floors: 0, equipment: 0, routes: 0, cables: 0, pins: 0 });
});

test('подпись поиска: найдено из полного числа, без фильтра — пусто', () => {
  assert.equal(searchCaption('', 0, 4), '');
  assert.equal(searchCaption('к1', 1, 4), 'Найдено: 1 из 4');
});
