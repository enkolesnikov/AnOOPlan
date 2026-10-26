import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project } from '../src/model';
import { affectedCableIds, allIds, bulkKind, isBulkTab, pageSlice, toggleId } from '../src/ui/multi-select';

const project = {
  equipment: [{ id: 'e1' }, { id: 'e2' }],
  routes: [{ id: 'r1', segments: [{ id: 's1' }, { id: 's2' }] }, { id: 'r2', segments: [{ id: 's3' }] }],
  cables: [
    { id: 'c1', fromId: 'e1', toId: 'e2', segmentIds: [] },
    { id: 'c2', fromId: 'e2', toId: 'e2', segmentIds: ['s1'] },
    { id: 'c3', fromId: 'e1', toId: 'e1', segmentIds: ['s3'] },
    { id: 'c4', fromId: 'e1', toId: 'e1', segmentIds: [] },
  ],
  pins: [{ id: 'p1' }],
} as unknown as Project;

test('мультивыбор: переключение и все id', () => {
  assert.deepEqual(toggleId([], 'a'), ['a']);
  assert.deepEqual(toggleId(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(toggleId(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(allIds([{ id: 'x' }, { id: 'y' }]), ['x', 'y']);
});

test('мультивыбор: вкладки и виды объектов', () => {
  assert.equal(isBulkTab('equipment'), true);
  assert.equal(isBulkTab('floors'), false);
  assert.equal(bulkKind('equipment'), 'equipment');
  assert.equal(bulkKind('routes'), 'route');
  assert.equal(bulkKind('cables'), 'cable');
  assert.equal(bulkKind('pins'), 'pin');
  assert.equal(bulkKind('floors'), null);
});

test('мультивыбор: порционная отрисовка', () => {
  const items = Array.from({ length: 250 }, (_, index) => index);
  assert.deepEqual(pageSlice(items, 80), items.slice(0, 80));
  assert.deepEqual(pageSlice(items, 0), []);
  assert.deepEqual(pageSlice(items, -5), []);
});

test('мультивыбор: связанные кабели при массовом удалении', () => {
  assert.deepEqual(affectedCableIds(project, 'equipment', ['e1']), ['c1', 'c3', 'c4']);
  assert.deepEqual(affectedCableIds(project, 'equipment', ['e2']), ['c1', 'c2']);
  assert.deepEqual(affectedCableIds(project, 'route', ['r1']), ['c2']);
  assert.deepEqual(affectedCableIds(project, 'route', ['r2']), ['c3']);
  assert.deepEqual(affectedCableIds(project, 'cable', ['c2']), ['c2']);
  assert.deepEqual(affectedCableIds(project, 'pin', ['p1']), []);
});
