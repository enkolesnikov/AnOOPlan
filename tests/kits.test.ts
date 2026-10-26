import test from 'node:test';
import assert from 'node:assert/strict';
import { EQUIPMENT_KITS, kitEquipment, nextKitNumber } from '../src/kits';
import { builtInTemplates } from '../src/templates';

test('комплекты: номера выдаются без конфликтов', () => {
  assert.equal(nextKitNumber('К', new Set()), 'К1');
  assert.equal(nextKitNumber('К', new Set(['К1', 'К2'])), 'К3');
});

test('комплекты: вставка сохраняет относительное расположение', () => {
  const project = builtInTemplates()[1].project;
  const floor = project.floors[0];
  const kit = EQUIPMENT_KITS[0];
  const items = kitEquipment(kit, project, floor);
  assert.equal(items.length, kit.items.length);
  assert.ok(items.every(item => item.floorId === floor.id));
  assert.equal(new Set(items.map(item => item.number)).size, items.length);
  const xs = items.map(item => item.x);
  const baseX = xs[0] - kit.items[0].dx;
  assert.deepEqual(xs, kit.items.map(item => baseX + item.dx));
});
