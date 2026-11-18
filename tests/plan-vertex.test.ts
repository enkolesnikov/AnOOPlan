import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteVertex, reverseCableRoute, reverseRoute } from '../src/plan-edits';
import { route, segment, vertex } from './fixtures';

const chain = () => route('r', [
  segment('s1', vertex('a', 0), vertex('m', 50)),
  segment('s2', vertex('m', 50), vertex('b', 100)),
  segment('s3', vertex('b', 100), vertex('c', 150)),
]);

test('удаление вершины: два соседних сегмента сливаются в один', () => {
  const result = deleteVertex(chain(), 'm');
  assert.ok(result);
  assert.equal(result.route.segments.length, 2);
  assert.deepEqual(result.oldSegmentIds, ['s1', 's2']);
  const merged = result.route.segments[0];
  assert.equal(merged.a.id, 'a');
  assert.equal(merged.b.id, 'b');
  assert.equal(merged.id, result.newSegmentId);
  assert.equal(result.mergedProperties, false);
});

test('удаление вершины: концевую/несуществующую вершину удалить нельзя', () => {
  assert.equal(deleteVertex(chain(), 'a'), null);
  assert.equal(deleteVertex(chain(), 'nope'), null);
});

test('удаление вершины: разные размеры дают предупреждение', () => {
  const source = chain();
  source.segments[1].trayWidthMm = 200;
  const result = deleteVertex(source, 'm');
  assert.ok(result);
  assert.equal(result.mergedProperties, true);
  assert.match(result.warning ?? '', /разные размеры/);
  assert.equal(result.route.segments[0].trayWidthMm, undefined);
});

test('удаление вершины-изгиба не создаёт диагональный ортогональный сегмент', () => {
  const elbow = route('r', [
    segment('s1', vertex('a', 0, 0), vertex('m', 50, 0)),
    segment('s2', vertex('m', 50, 0), vertex('b', 50, 50)),
  ]);
  assert.equal(deleteVertex(elbow, 'm'), null);
});

test('удаление стыка стояка с разными x/y отклоняется', () => {
  const riser = route('r', [
    segment('s1', vertex('a', 0, 0, 3, 'f1'), vertex('m', 50, 0, 3, 'f1')),
    segment('s2', vertex('m', 50, 0, 3, 'f1'), vertex('b', 60, 0, 3, 'f2'), { mode: 'spatial' }),
  ]);
  assert.equal(deleteVertex(riser, 'm'), null);
});

test('реверс трассы меняет порядок и концы, кабель — порядок сегментов', () => {
  const reversed = reverseRoute(chain());
  assert.deepEqual(reversed.segments.map(segment => segment.id), ['s3', 's2', 's1']);
  assert.equal(reversed.segments[0].a.id, 'c');
  assert.equal(reversed.segments[0].b.id, 'b');
  const reversedCable = reverseCableRoute({ segmentIds: ['x', 's1', 's2'] } as never, ['s1', 's2']);
  assert.deepEqual(reversedCable.segmentIds, ['x', 's2', 's1']);
});

test('реверс одной трассы не переворачивает сегменты соседней', () => {
  const cable = { segmentIds: ['a1', 'a2', 'b1', 'b2'] } as never;
  const reversed = reverseCableRoute(cable, ['b1', 'b2']);
  assert.deepEqual(reversed.segmentIds, ['a1', 'a2', 'b2', 'b1']);
  const broken = reverseCableRoute({ segmentIds: ['b1', 'a1', 'b2'] } as never, ['b1', 'b2']);
  assert.deepEqual(broken.segmentIds, ['b1', 'a1', 'b2'], 'непрерывность важнее реверса');
});
