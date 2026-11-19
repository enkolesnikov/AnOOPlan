import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentIndex } from '../src/engine/geometry';
import { baseProject, cable, route, segment, vertex } from './fixtures';

/**
 * P-02: индекс сегментов один на структуру проекта. Кэш обязан замечать
 * замену/вставку сегментов, иначе расчёт кабеля после правки увидит старый мир.
 */

const project = () => {
  const [s1, s2] = [segment('s1', vertex('a', 0, 0), vertex('b', 10, 0)), segment('s2', vertex('b', 10, 0), vertex('c', 20, 0))];
  const p = baseProject({
    routes: [route('Т1', [s1, s2])],
    cables: [cable({ id: 'c1', number: 'К1', segmentIds: ['s1', 's2'] })],
  });
  return { p, s1, s2 };
};

test('segmentIndex: повторный вызов на неизменном проекте переиспользует индекс', () => {
  const { p } = project();
  const first = segmentIndex(p);
  const second = segmentIndex(p);
  assert.equal(first, second, 'тот же объект индекса');
});

test('segmentIndex: перетаскивание вершины не сбрасывает индекс, координаты видны', () => {
  const { p, s1 } = project();
  const first = segmentIndex(p);
  s1.a.x = 5;
  const second = segmentIndex(p);
  assert.equal(first, second, 'координаты не меняют структуру');
  assert.equal(second.segments.get('s1')?.a.x, 5);
});

test('segmentIndex: замена массива сегментов пересоздаёт индекс', () => {
  const { p } = project();
  const first = segmentIndex(p);
  const replacement = segment('s3', vertex('a', 0, 0), vertex('b', 10, 0));
  p.routes[0].segments = [replacement];
  const second = segmentIndex(p);
  assert.notEqual(first, second);
  assert.equal(second.segments.has('s3'), true);
  assert.equal(second.segments.has('s1'), false);
});

test('segmentIndex: вставка сегмента в тот же массив пересоздаёт индекс', () => {
  const { p } = project();
  const first = segmentIndex(p);
  p.routes[0].segments.push(segment('s3', vertex('c', 20, 0), vertex('d', 30, 0)));
  const second = segmentIndex(p);
  assert.notEqual(first, second);
  assert.equal(second.segments.has('s3'), true);
});

test('segmentIndex: дубликат ID виден после пересоздания', () => {
  const { p } = project();
  p.routes[0].segments = [
    segment('dup', vertex('a', 0, 0), vertex('b', 10, 0)),
    segment('dup', vertex('c', 20, 0), vertex('d', 30, 0)),
  ];
  const index = segmentIndex(p);
  assert.deepEqual([...index.duplicates], ['dup']);
});
