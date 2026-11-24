// Здания проекта: группы этажей. Необязательное поле (3.3.0): старые проекты
// загружаются без изменений, висячие ссылки этажей на здания отбрасываются,
// серверная валидация требует существующего здания.
import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateProject } from '../src/migrations';
import { assertProject } from '../server/validation.js';
import { groupFloorsByBuilding } from '../src/ui/floor-groups';
import { baseProject, floor, rejectsProject } from './fixtures';

const noPdf = () => true;

test('старый проект без зданий не обзаводится полем buildings', () => {
  const migrated = migrateProject(JSON.parse(JSON.stringify(baseProject())));
  assert.equal('buildings' in migrated, false);
  for (const item of migrated.floors) assert.equal('buildingId' in item, false);
});

test('здания и привязка этажей переживают цикл сохранения и загрузки', () => {
  const source = baseProject({
    buildings: [{ id: 'b1', name: 'Корпус А' }, { id: 'b2', name: 'Корпус Б' }],
    floors: [floor('f1', { buildingId: 'b1' }), floor('f2', { buildingId: 'b2' })],
  });
  const migrated = migrateProject(JSON.parse(JSON.stringify(source)));
  assert.deepEqual(migrated.buildings, source.buildings);
  assert.equal(migrated.floors[0].buildingId, 'b1');
  assert.equal(migrated.floors[1].buildingId, 'b2');
  // Повторная загрузка стабильна.
  assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(migrated))), migrated);
});

test('висячая привязка этажа к несуществующему зданию отбрасывается', () => {
  const source = baseProject({
    buildings: [{ id: 'b1', name: 'Корпус А' }],
    floors: [floor('f1', { buildingId: 'b1' }), floor('f2', { buildingId: 'b-gone' })],
  });
  const migrated = migrateProject(JSON.parse(JSON.stringify(source)));
  assert.equal(migrated.floors[0].buildingId, 'b1');
  assert.equal('buildingId' in migrated.floors[1], false);
});

test('мусор в списке зданий отбрасывается, дубли id разводятся, пустой список не хранится', () => {
  const raw = JSON.parse(JSON.stringify(baseProject())) as Record<string, unknown>;
  raw.buildings = [
    'мусор',
    { id: '', name: 'Без id' },
    { id: 'b1', name: '  Корпус А  ' },
    { id: 'b1', name: 'Дубль' },
    { id: 'b2' },
  ];
  const migrated = migrateProject(raw);
  assert.deepEqual(migrated.buildings, [
    { id: 'b1', name: 'Корпус А' },
    { id: 'b1-д', name: 'Дубль' },
    { id: 'b2', name: 'Здание' },
  ]);
  const empty = migrateProject(JSON.parse(JSON.stringify({ ...baseProject(), buildings: [] })));
  assert.equal('buildings' in empty, false);
  const garbage = migrateProject(JSON.parse(JSON.stringify({ ...baseProject(), buildings: 'мусор' })));
  assert.equal('buildings' in garbage, false);
});

test('сервер принимает проект со зданиями и привязанными этажами', () => {
  const project = baseProject({
    buildings: [{ id: 'b1', name: 'Корпус А' }],
    floors: [floor('f1', { buildingId: 'b1' }), floor('f2')],
  });
  assert.doesNotThrow(() => assertProject(project, noPdf));
  // null — этаж явно без здания.
  const withNull = baseProject({
    buildings: [{ id: 'b1', name: 'Корпус А' }],
    floors: [floor('f1', { buildingId: null }), floor('f2', { buildingId: 'b1' })],
  });
  assert.doesNotThrow(() => assertProject(withNull, noPdf));
});

test('сервер отклоняет этаж со ссылкой на несуществующее здание', () => {
  const project = baseProject({
    buildings: [{ id: 'b1', name: 'Корпус А' }],
    floors: [floor('f1', { buildingId: 'b-gone' }), floor('f2')],
  });
  rejectsProject(project, /Здание не найдено/);
});

test('сервер отклоняет здания без имени и с повтором id', () => {
  rejectsProject(baseProject({ buildings: [{ id: 'b1', name: '  ' }] }), /building.name/);
  rejectsProject(baseProject({ buildings: [{ id: 'b1', name: 'А' }, { id: 'b1', name: 'Б' }] }), /Повтор ID/);
  rejectsProject(baseProject({ buildings: 'мусор' as unknown as never }), /project\.buildings/);
});

test('группировка этажей по зданиям: порядок зданий, затем этажи без здания', () => {
  const project = baseProject({
    buildings: [{ id: 'b1', name: 'Корпус А' }, { id: 'b2', name: 'Корпус Б' }],
    floors: [
      floor('f1', { buildingId: 'b1' }),
      floor('f2'),
      floor('f3', { buildingId: 'b2' }),
      floor('f4', { buildingId: 'b1' }),
    ],
  });
  const groups = groupFloorsByBuilding(project);
  assert.deepEqual(groups.map(group => group.building?.name ?? null), ['Корпус А', 'Корпус Б', null]);
  assert.deepEqual(groups[0].floors.map(item => item.id), ['f1', 'f4']);
  assert.deepEqual(groups[1].floors.map(item => item.id), ['f3']);
  assert.deepEqual(groups[2].floors.map(item => item.id), ['f2']);
  assert.equal(groups[0].total, 2);
});

test('группировка: без зданий — плоская группа, здание без этажей не образует группу', () => {
  const flat = groupFloorsByBuilding(baseProject());
  assert.equal(flat.length, 1);
  assert.equal(flat[0].building, null);
  assert.equal(flat[0].floors.length, 2);
  const project = baseProject({
    buildings: [{ id: 'b1', name: 'Пустой корпус' }, { id: 'b2', name: 'Корпус Б' }],
    floors: [floor('f1', { buildingId: 'b2' }), floor('f2', { buildingId: 'b-gone' })],
  });
  const groups = groupFloorsByBuilding(project);
  assert.deepEqual(groups.map(group => group.building?.name ?? null), ['Корпус Б', null]);
  // Висячая ссылка на удалённое здание попадает в группу «без здания».
  assert.deepEqual(groups[1].floors.map(item => item.id), ['f2']);
});
