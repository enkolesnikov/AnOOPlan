import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_SCHEMA_VERSION, migrateProject, ProjectSchemaError } from '../src/migrations';
import type { Project } from '../src/model';

function project(): Project {
  return {
    schemaVersion: 1, id: 'p1', name: 'Проект', updatedAt: '2026-01-01T00:00:00Z',
    floors: [{ id: 'f1', name: 'Этаж', elevation: 0, metersPerUnit: 0.1, page: 1, width: 1000, height: 700 }],
    equipment: [{ id: 'e1', number: 'E1', name: 'Камера', type: 'Камера', floorId: 'f1', x: 1, y: 2, height: null, note: '', properties: {} }],
    routes: [], cables: [],
  };
}

test('валидный проект v1 проходит миграцию без потери данных', () => {
  const source = project();
  const migrated = migrateProject(source);
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.id, source.id);
  assert.deepEqual(migrated.floors, source.floors);
  assert.deepEqual(migrated.routes, source.routes);
  assert.deepEqual(migrated.cables, source.cables);
  assert.deepEqual(migrated.equipment[0], { ...source.equipment[0], photos: [] });
  assert.equal(CURRENT_SCHEMA_VERSION, 1);
});

test('старый JSON без schemaVersion и photos нормализуется', () => {
  const legacy = JSON.parse(JSON.stringify(project())) as Record<string, unknown>;
  delete legacy.schemaVersion;
  const equipment = (legacy.equipment as Record<string, unknown>[])[0];
  delete equipment.photos;
  equipment.note = undefined;
  const migrated = migrateProject(legacy);
  assert.equal(migrated.schemaVersion, 1);
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
