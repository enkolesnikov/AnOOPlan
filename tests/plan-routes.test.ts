import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRoutes, splitRouteAtVertex } from '../src/plan-edits';
import { route, segment, vertex } from './fixtures';

function chain(id = 'r') {
  return route(id, [
    segment('s1', vertex('a', 0), vertex('m', 50)),
    segment('s2', vertex('m', 50), vertex('b', 100)),
    segment('s3', vertex('b', 100), vertex('c', 150)),
  ]);
}

test('разделение трассы по внутренней вершине', () => {
  const result = splitRouteAtVertex(chain(), 'm', 'r2');
  assert.ok(result);
  assert.equal(result.first.id, 'r');
  assert.equal(result.second.id, 'r2');
  assert.deepEqual(result.first.segments.map(s => s.id), ['s1']);
  assert.deepEqual(result.second.segments.map(s => s.id), ['s2', 's3']);
  assert.equal(result.first.segments[0].b.id, 'm');
  assert.equal(result.second.segments[0].a.id, 'm');
});

test('разделение невозможно по концевой/несуществующей вершине', () => {
  assert.equal(splitRouteAtVertex(chain(), 'a'), null);
  assert.equal(splitRouteAtVertex(chain(), 'c'), null);
  assert.equal(splitRouteAtVertex(chain(), 'nope'), null);
});

test('объединение трасс в прямом и обратном направлении', () => {
  const first = route('r1', [segment('a1', vertex('a', 0), vertex('b', 50))]);
  const direct = route('r2', [segment('b1', vertex('b', 50), vertex('c', 100))]);
  const merged = mergeRoutes(first, direct);
  assert.ok(merged);
  assert.deepEqual(merged.segments.map(s => s.id), ['a1', 'b1']);
  const reversed = route('r3', [segment('c1', vertex('c', 100), vertex('b', 50))]);
  const merged2 = mergeRoutes(first, reversed);
  assert.ok(merged2);
  assert.deepEqual(merged2.segments.map(s => s.id), ['a1', 'c1']);
  assert.equal(merged2.segments[1].a.id, 'b');
  assert.equal(merged2.segments[1].b.id, 'c');
});

test('трассы с несовпадающим стыком не объединяются', () => {
  const first = route('r1', [segment('a1', vertex('a', 0), vertex('b', 50))]);
  const far = route('r2', [segment('b1', vertex('x', 300), vertex('y', 350))]);
  assert.equal(mergeRoutes(first, far), null);
});
