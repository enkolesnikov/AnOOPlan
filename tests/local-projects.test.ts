import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project } from '../src/model';
import { CORRUPT_PROJECTS_KEY, deleteLocalProject, readLocalProjects, saveLocalProject, type ProjectStorage } from '../src/local-projects';
import { baseProject } from './fixtures';

function storage(): ProjectStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

const project = (id: string, name = id): Project =>
  baseProject({ id, name, floors: [], equipment: [], routes: [], cables: [], pins: [] });

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
});

test('повреждённый список не затирается: копия сохранена, запись отклонена', () => {
  const store = storage();
  store.setItem('cableplan:projects', '{bad json');
  assert.throws(() => saveLocalProject(project('p3'), store), /повреждён/);
  assert.equal(store.getItem('cableplan:projects'), '{bad json');
  assert.equal(store.getItem(CORRUPT_PROJECTS_KEY), '{bad json');
});
