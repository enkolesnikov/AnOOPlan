import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import type { Project } from '../src/model';
import { CORRUPT_PROJECTS_KEY, PROJECTS_KEY, type ProjectStorage } from '../src/local-projects';
import {
  MIGRATED_PROJECTS_KEY,
  PROJECT_STORE,
  deleteStoredProject,
  hasLegacyProjectList,
  listStoredProjects,
  migrateProjectsToIdb,
  readStoredProject,
  saveStoredProject,
} from '../src/project-store';
import { idbStoreGetAll, idbStoreKeys } from '../src/idb';
import { baseProject } from './fixtures';

function storage(): ProjectStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
  };
}

const project = (id: string, name = id): Project =>
  baseProject({ id, name, floors: [], equipment: [], routes: [], cables: [], pins: [] });

test('проект сохраняется, читается и удаляется из IndexedDB', async () => {
  await saveStoredProject(project('a1'));
  await saveStoredProject(project('a1', 'Переименован'));
  await saveStoredProject(project('a2'));
  assert.equal((await readStoredProject('a1'))?.name, 'Переименован');
  const names = (await listStoredProjects()).map(item => item.id).sort();
  assert.deepEqual(names, ['a1', 'a2']);
  await deleteStoredProject('a1');
  assert.equal(await readStoredProject('a1'), undefined);
  assert.deepEqual((await listStoredProjects()).map(item => item.id), ['a2']);
});

test('список объединяет IndexedDB и legacy localStorage без дублей', async () => {
  const store = storage();
  store.setItem(PROJECTS_KEY, JSON.stringify([project('legacy', 'Старый'), project('shared', 'Из localStorage')]));
  await saveStoredProject(project('shared', 'Из IndexedDB'));
  const list = (await listStoredProjects(store)).filter(item => item.id === 'legacy' || item.id === 'shared');
  assert.equal(list.length, 2, 'общий id не дублируется');
  assert.equal(list.find(item => item.id === 'shared')?.name, 'Из IndexedDB', 'IndexedDB — источник истины');
  assert.equal(list.find(item => item.id === 'legacy')?.name, 'Старый');
});

test('миграция переносит список в IndexedDB, оригинал остаётся страховкой', async () => {
  const store = storage();
  const source = [project('m1'), project('m2', 'Второй')];
  store.setItem(PROJECTS_KEY, JSON.stringify(source));
  assert.equal(hasLegacyProjectList(store), true);
  const moved = await migrateProjectsToIdb(store);
  assert.equal(moved, 2);
  assert.equal(store.getItem(PROJECTS_KEY), null, 'ключ очищен, чтобы GC не видел проекты дважды');
  assert.equal(store.getItem(MIGRATED_PROJECTS_KEY), JSON.stringify(source), 'страховочная копия сохранена');
  const keys = await idbStoreKeys(PROJECT_STORE);
  assert.ok(keys.includes('m1') && keys.includes('m2'), 'оба проекта перенесены в IndexedDB');
  assert.equal(hasLegacyProjectList(store), false);
  // Повторная миграция — холостая: переносить уже нечего.
  assert.equal(await migrateProjectsToIdb(store), 0);
});

test('миграция повреждённого списка: не затирает, копирует в corrupt-ключ', async () => {
  const store = storage();
  store.setItem(PROJECTS_KEY, '{битый json');
  const moved = await migrateProjectsToIdb(store);
  assert.equal(moved, 0);
  assert.equal(store.getItem(PROJECTS_KEY), '{битый json', 'повреждённый список остаётся на месте');
  assert.equal(store.getItem(CORRUPT_PROJECTS_KEY), '{битый json');
});

test('миграция без localStorage-списка — холостая', async () => {
  const store = storage();
  assert.equal(await migrateProjectsToIdb(store), 0);
});

test('записи без строкового id не попадают в список', async () => {
  const store = storage();
  store.setItem(PROJECTS_KEY, JSON.stringify([{ name: 'без id' }, project('ok')]));
  const moved = await migrateProjectsToIdb(store);
  assert.equal(moved, 1);
  const all = await idbStoreGetAll<Project>(PROJECT_STORE);
  assert.ok(all.every(item => item && typeof item.id === 'string'), 'записей без id в хранилище нет');
  assert.ok(all.some(item => item.id === 'ok'), 'валидный проект перенесён');
});
