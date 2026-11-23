import test from 'node:test';
import assert from 'node:assert/strict';
import { pointVisible, segmentVisible, visibleFloorRect } from '../src/plan-culling';

test('видимый прямоугольник считается из pan/zoom и размеров вьюпорта', () => {
  // Камера: pan (35, 35), zoom 1, вьюпорт 800×600 → виден лист от (-35,-35) до (765,565).
  const rect = visibleFloorRect({ x: 35, y: 35 }, 1, 800, 600, 0)!;
  assert.deepEqual(rect, { x0: -35, y0: -35, x1: 765, y1: 565 });
  // Зум 2: в кадре вдвое меньше листа.
  const zoomed = visibleFloorRect({ x: 35, y: 35 }, 2, 800, 600, 0)!;
  assert.deepEqual(zoomed, { x0: -17.5, y0: -17.5, x1: 382.5, y1: 282.5 });
  // Отрицательный pan (панорама вправо-вниз): левая граница уходит вглубь листа.
  const panned = visibleFloorRect({ x: -200, y: -100 }, 1, 800, 600, 10)!;
  assert.deepEqual(panned, { x0: 190, y0: 90, x1: 1010, y1: 710 });
});

test('неизвестные размеры вьюпорта и нулевой зум дают null (рендерить всё)', () => {
  assert.equal(visibleFloorRect({ x: 0, y: 0 }, 1, 0, 600), null);
  assert.equal(visibleFloorRect({ x: 0, y: 0 }, 1, 800, 0), null);
  assert.equal(visibleFloorRect({ x: 0, y: 0 }, 0, 800, 600), null);
  assert.equal(visibleFloorRect({ x: 0, y: 0 }, Number.NaN, 800, 600), null);
});

test('точка проверяется с допуском на размер символа', () => {
  const rect = { x0: 0, y0: 0, x1: 100, y1: 100 };
  assert.equal(pointVisible(rect, 50, 50), true);
  assert.equal(pointVisible(rect, 150, 50), false);
  assert.equal(pointVisible(rect, 110, 50, 20), true, 'допуск держит символ на границе');
  assert.equal(pointVisible(rect, -5, 50, 10), true);
  assert.equal(pointVisible(rect, -20, 50, 10), false);
});

test('отрезок пересекает видимый прямоугольник по рамке', () => {
  const rect = { x0: 0, y0: 0, x1: 100, y1: 100 };
  assert.equal(segmentVisible(rect, 10, 10, 90, 90), true, 'внутри');
  assert.equal(segmentVisible(rect, -50, 50, 50, 50), true, 'частично в кадре');
  assert.equal(segmentVisible(rect, 200, 10, 300, 20), false, 'справа от кадра');
  assert.equal(segmentVisible(rect, 10, 300, 90, 400), false, 'ниже кадра');
  assert.equal(segmentVisible(rect, 101, 10, 200, 20, 2), true, 'допуск держит линию у кромки');
});
