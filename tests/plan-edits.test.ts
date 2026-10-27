import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceCableSegment, segmentSplitPoint, splitSegment } from '../src/plan-edits';
import type { Cable, Segment, Vertex } from '../src/model';

const a: Vertex = { id: 'a', floorId: 'f1', x: 0, y: 0, height: 2 };
const b: Vertex = { id: 'b', floorId: 'f1', x: 100, y: 0, height: 4 };
const segment: Segment = { id: 's', a, b, mode: 'orthogonal', reservePercent: 10, reserveFixed: 0, trayWidthMm: 100 };

test('вставка вершины: проекция точки на сегмент', () => {
  const split = segmentSplitPoint(segment, { x: 50, y: 30 });
  assert.ok(split);
  assert.equal(split.vertex.x, 50);
  assert.equal(split.vertex.y, 0);
  assert.equal(split.vertex.height, 3);
});

test('вставка вершины: концы не ближе 10 % и размеры сохраняются', () => {
  const near = splitSegment(segment, { x: 2, y: 0 });
  assert.ok(near);
  assert.equal(near.vertex.x, 10);
  assert.equal(near.first.trayWidthMm, 100);
  assert.equal(near.second.reservePercent, 10);
  assert.equal(near.first.b.id, near.vertex.id);
  assert.equal(near.second.a.id, near.vertex.id);
});

test('вставка вершины: межэтажный сегмент не делится', () => {
  const riser: Segment = { ...segment, b: { ...b, floorId: 'f2' } };
  assert.equal(segmentSplitPoint(riser, { x: 50, y: 0 }), null);
  assert.equal(splitSegment(riser, { x: 50, y: 0 }), null);
});

test('вставка вершины: цепочка кабеля получает оба сегмента по порядку', () => {
  const cable: Cable = { id: 'c', number: 'Л1', name: '', brand: '', purpose: '', fromId: 'e1', toId: 'e2', segmentIds: ['x', 's', 'y'], reservePercent: 0, reserveFixed: 0, startReserve: 0, endReserve: 0, quantity: 1, note: '' };
  const next = replaceCableSegment(cable, 's', 's1', 's2');
  assert.deepEqual(next.segmentIds, ['x', 's1', 's2', 'y']);
  assert.deepEqual(replaceCableSegment(cable, 'other', 's1', 's2').segmentIds, ['x', 's', 'y']);
});
