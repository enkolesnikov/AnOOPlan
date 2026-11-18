import test from 'node:test';
import assert from 'node:assert/strict';
import { removeFloor } from '../src/floor-edits';
import type { Project } from '../src/model';
import { baseProject, cable, device, floor, pin, readRepoFile, route, segment, vertex } from './fixtures';

function project(): Project {
  return baseProject({
    name: 'Два этажа',
    floors: [floor('f1', { name: 'Этаж 1' }), floor('f2', { name: 'Этаж 2' })],
    equipment: [
      device('e1', 0, { floorId: 'f1', photos: ['photo-1'] }),
      device('e2', 0, { floorId: 'f2', photos: ['photo-2'] }),
    ],
    routes: [route('r1', [
      segment('s1', vertex('v1', 0, 0, 0), vertex('v2', 100, 0, 0)),
      segment('s2', vertex('v2', 100, 0, 0), vertex('v3', 100, 0, 0, 'f2'), { mode: 'spatial' }),
    ])],
    pins: [pin('p1', { floorId: 'f1' }), pin('p2', { floorId: 'f2' })],
    cables: [cable({ id: 'c1', fromId: 'e1', toId: 'e2', segmentIds: ['s1', 's2'] })],
  });
}

test('removeFloor удаляет объекты и сегменты этажа вместе с кабелем', () => {
  const p = project();
  const result = removeFloor(p, 'f2');
  assert.deepEqual(result, { equipmentIds: ['e2'], segmentIds: ['s2'] });
  assert.deepEqual(p.floors.map(item => item.id), ['f1']);
  assert.deepEqual(p.equipment.map(item => item.id), ['e1']);
  assert.deepEqual(p.pins.map(item => item.id), ['p1']);
  assert.deepEqual(p.routes.flatMap(item => item.segments).map(item => item.id), ['s1']);
  assert.equal(p.cables.length, 0);
});

test('панель этажа не удаляет блобы напрямую (защита от возврата D-01)', () => {
  const source = readRepoFile('src/ui/properties-panel.tsx');
  assert.ok(source.includes('removeFloor'), 'удаление этажа должно идти через removeFloor');
  assert.ok(!source.includes('idbDelete'), 'панель не должна импортировать idbDelete');
  assert.ok(!source.includes('purgePhotoBlobs'), 'второго пути очистки быть не должно');
});

test('removeFloor: единственный этаж и неизвестный id не удаляются', () => {
  const one = baseProject({ floors: [floor('f1')], equipment: [], routes: [], cables: [{ ...cable(), fromId: 'a', toId: 'b', segmentIds: [] }], pins: [] });
  assert.equal(removeFloor(one, 'f1'), null);
  assert.equal(one.floors.length, 1);
  const p = project();
  assert.equal(removeFloor(p, 'missing'), null);
  assert.equal(p.floors.length, 2);
});

test('removeFloor удаляет опустевшую трассу, но не чужую', () => {
  const p = project();
  p.routes.push(route('r2', [segment('s3', vertex('v4', 0, 0, 0, 'f1'), vertex('v5', 10, 0, 0, 'f1'))]));
  removeFloor(p, 'f2');
  assert.deepEqual(p.routes.map(item => item.id), ['r1', 'r2']);
  assert.deepEqual(p.routes[0].segments.map(item => item.id), ['s1']);
  assert.equal(p.routes[1].segments.length, 1);
});
