import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_SCHEMA_VERSION, migrateProject, ProjectSchemaError } from '../src/migrations';
import type { Project } from '../src/model';

function project(): Project {
  return {
    schemaVersion: 1, id: 'p1', name: 'Проект', updatedAt: '2026-01-01T00:00:00Z',
    floors: [{ id: 'f1', name: 'Этаж', elevation: 0, metersPerUnit: 0.1, page: 1, width: 1000, height: 700 }],
    equipment: [{ id: 'e1', number: 'E1', name: 'Камера', type: 'Камера', floorId: 'f1', x: 1, y: 2, height: null, note: '', properties: {} }],
    routes: [], cables: [], pins: [],
  };
}

test('валидный проект v1 мигрирует в v2 без потери данных', () => {
  const source = project();
  const migrated = migrateProject(source);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.id, source.id);
  assert.deepEqual(migrated.floors, source.floors);
  assert.deepEqual(migrated.routes, source.routes);
  assert.deepEqual(migrated.cables, source.cables);
  assert.deepEqual(migrated.pins, []);
  assert.deepEqual(migrated.equipment[0], { ...source.equipment[0], photos: [] });
  assert.equal(CURRENT_SCHEMA_VERSION, 2);
});

test('проект v2 сохраняет пины и нормализует их поля', () => {
  const source = JSON.parse(JSON.stringify(project())) as Record<string, unknown>;
  source.schemaVersion = 2;
  source.pins = [{ id: 'z1', number: 'З-1', floorId: 'f1', x: 10, y: 20, comment: 'Проверить', status: 'open', photos: ['p1'] }];
  const migrated = migrateProject(source);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.pins.length, 1);
  assert.equal(migrated.pins[0].number, 'З-1');
  assert.equal(migrated.pins[0].status, 'open');
  assert.deepEqual(migrated.pins[0].photos, ['p1']);
  assert.ok(migrated.pins[0].createdAt);
});

test('старый JSON без schemaVersion и photos нормализуется', () => {
  const legacy = JSON.parse(JSON.stringify(project())) as Record<string, unknown>;
  delete legacy.schemaVersion;
  const equipment = (legacy.equipment as Record<string, unknown>[])[0];
  delete equipment.photos;
  equipment.note = undefined;
  const migrated = migrateProject(legacy);
  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.equipment[0].photos, []);
  assert.equal(migrated.equipment[0].note, '');
});

test('проект из будущей версии отклоняется понятной ошибкой', () => {
  const future = { ...project(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
  assert.throws(() => migrateProject(future), (error: unknown) =>
    error instanceof ProjectSchemaError && /более новой версией/.test(error.message));
});

test('повреждённые обязательные списки и идентификатор отклоняются', () => {
  assert.throws(() => migrateProject({ schemaVersion: 1, id: 'p' }), ProjectSchemaError);
  const broken = JSON.parse(JSON.stringify(project())) as Record<string, unknown>;
  broken.floors = 'нет';
  assert.throws(() => migrateProject(broken), /обязательные списки/);
  const noId = JSON.parse(JSON.stringify(project())) as Record<string, unknown>;
  delete noId.id;
  assert.throws(() => migrateProject(noId), /идентификатор/);
});

function rawProject(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(project())) as Record<string, unknown>;
}

function pushRoute(raw: Record<string, unknown>, extra: Record<string, unknown>): void {
  (raw.routes as Record<string, unknown>[]).push({ id: 'r1', number: 'Т1', type: 'Лоток', note: '', segments: [], ...extra });
}

function pushCable(raw: Record<string, unknown>, extra: Record<string, unknown>): void {
  (raw.cables as Record<string, unknown>[]).push({
    id: 'c1', number: 'К1', name: 'Линия', brand: 'ВВГ', purpose: '', fromId: 'e1', toId: 'e1',
    segmentIds: [], reservePercent: 0, reserveFixed: 0, startReserve: 0, endReserve: 0, quantity: 1, note: '',
    ...extra,
  });
}

test('старый проект без полей лотка и сечения загружается: undefined, а не 0', () => {
  const raw = rawProject();
  pushRoute(raw, {});
  pushCable(raw, {});
  const migrated = migrateProject(raw);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.routes[0].trayWidthMm, undefined);
  assert.equal(migrated.routes[0].trayHeightMm, undefined);
  assert.equal(migrated.routes[0].trayAreaMm2, undefined);
  assert.equal(migrated.cables[0].outerDiameterMm, undefined);
  assert.equal(migrated.cables[0].crossSectionMm2, undefined);
});

test('мусорные новые поля не превращаются в 0 и не роняют загрузку', () => {
  const raw = rawProject();
  raw.schemaVersion = 2;
  pushRoute(raw, { trayWidthMm: 'широкий', trayHeightMm: Number.NaN, trayAreaMm2: null });
  pushCable(raw, { outerDiameterMm: 'abc', crossSectionMm2: Number.POSITIVE_INFINITY });
  pushCable(raw, { id: 'c2', number: 'К2', outerDiameterMm: -5, crossSectionMm2: '6.5' });
  // Пустая строка, boolean и массив не должны коэрситься в 0/1/50.
  pushCable(raw, { id: 'c3', number: 'К3', outerDiameterMm: '', crossSectionMm2: '   ' });
  pushCable(raw, { id: 'c4', number: 'К4', outerDiameterMm: true, crossSectionMm2: false });
  pushCable(raw, { id: 'c5', number: 'К5', outerDiameterMm: [50], crossSectionMm2: {} });
  (raw.routes as Record<string, unknown>[]).push({
    id: 'r2', number: 'Т2', type: 'Лоток', note: '', segments: [],
    trayWidthMm: true, trayHeightMm: '', trayAreaMm2: [],
  });
  const migrated = migrateProject(raw);
  assert.equal(migrated.routes[0].trayWidthMm, undefined);
  assert.equal(migrated.routes[0].trayHeightMm, undefined);
  assert.equal(migrated.routes[0].trayAreaMm2, undefined);
  assert.equal(migrated.routes[1].trayWidthMm, undefined);
  assert.equal(migrated.routes[1].trayHeightMm, undefined);
  assert.equal(migrated.routes[1].trayAreaMm2, undefined);
  assert.equal(migrated.cables[0].outerDiameterMm, undefined);
  assert.equal(migrated.cables[0].crossSectionMm2, undefined);
  assert.equal(migrated.cables[1].outerDiameterMm, -5);
  assert.equal(migrated.cables[1].crossSectionMm2, 6.5);
  for (const index of [2, 3, 4]) {
    assert.equal(migrated.cables[index].outerDiameterMm, undefined);
    assert.equal(migrated.cables[index].crossSectionMm2, undefined);
  }
});

test('корректные размеры лотка и сечения переживают JSON round-trip', () => {
  const raw = rawProject();
  pushRoute(raw, { trayWidthMm: 100, trayHeightMm: 50, trayAreaMm2: 5000 });
  pushCable(raw, { outerDiameterMm: 6, crossSectionMm2: 28.27 });
  const first = migrateProject(raw);
  assert.equal(first.schemaVersion, 2);
  assert.equal(first.routes[0].trayWidthMm, 100);
  assert.equal(first.routes[0].trayHeightMm, 50);
  assert.equal(first.routes[0].trayAreaMm2, 5000);
  assert.equal(first.cables[0].outerDiameterMm, 6);
  assert.equal(first.cables[0].crossSectionMm2, 28.27);
  const second = migrateProject(JSON.parse(JSON.stringify(first)));
  assert.equal(second.schemaVersion, 2);
  assert.deepEqual(second.routes, first.routes);
  assert.deepEqual(second.cables, first.cables);
});
