import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project } from '../src/model';
import { deleteLocalProject, readLocalProjects, saveLocalProject, type ProjectStorage } from '../src/local-projects';

function storage(): ProjectStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

const project = (id: string, name = id): Project => ({
  schemaVersion: 1, id, name, updatedAt: '2026-01-01T00:00:00Z',
  floors: [], equipment: [], routes: [], cables: [],
});

test('проекты сохраняются, обновляются и удаляются', () => {
  const store = storage();
  saveLocalProject(project('p1'), store);
  saveLocalProject(project('p1', 'Новое имя'), store);
  saveLocalProject(project('p2'), store);
  assert.deepEqual(readLocalProjects(store).map(item => item.name), ['Новое имя', 'p2']);
  deleteLocalProject('p1', store);
  assert.deepEqual(readLocalProjects(store).map(item => item.id), ['p2']);
});

test('повреждённое хранилище не ломает загрузку', () => {
  const store = storage();
  store.setItem('cableplan:projects', 'не json');
  assert.deepEqual(readLocalProjects(store), []);
  store.data.set('cableplan:projects', '{"not":"array"}');
  assert.deepEqual(readLocalProjects(store), []);
  saveLocalProject(project('p3'), store);
  assert.deepEqual(readLocalProjects(store).map(item => item.id), ['p3']);
});
