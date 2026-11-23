import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import type { Project } from '../src/model';
import type { WorkspaceState } from '../src/ui/use-workspace-state';
import { useProjectIo } from '../src/ui/use-project-io';
import { PROJECTS_KEY } from '../src/local-projects';
import { listStoredProjects } from '../src/project-store';
import { idbDelete, idbGet, idbStoreDelete, idbStoreGet, idbStoreKeys, idbStorePut } from '../src/idb';
import type { SnapshotEntry } from '../src/use-snapshots';
import { baseProject, device, floor } from './fixtures';

/**
 * Прямые тесты статического (браузерного) режима useProjectIo: сохранение,
 * удаление открытого проекта и импорт .anooplan с вложениями.
 * useProjectIo — не React-хук с состоянием, поэтому вызываем его напрямую,
 * подставив минимальный WorkspaceState.
 */

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
Object.defineProperty(globalThis, 'window', { value: { confirm: () => true }, configurable: true });

interface Harness {
  state: WorkspaceState;
  loads: { project: unknown; exists: boolean }[];
  saved: string[];
  persisted: boolean[];
  messages: string[];
  errors: string[];
  snapshotReasons: string[];
}

function harness(project: Project): Harness {
  const loads: Harness['loads'] = [];
  const saved: string[] = [];
  const persisted: boolean[] = [];
  const messages: string[] = [];
  const errors: string[] = [];
  const snapshotReasons: string[] = [];
  let projects: { id: string; name: string; updatedAt: string }[] | null = null;
  const state = {
    projectRef: { current: project },
    staticMode: true,
    persisted: false,
    dirty: false,
    dirtyRef: { current: false },
    setPersisted: (value: boolean) => { persisted.push(value); },
    setSaved: (value: string) => { saved.push(value); },
    setProject: () => { /* проект обновляется через load */ },
    setProjects: (update: unknown) => {
      projects = typeof update === 'function'
        ? (update as (list: typeof projects) => typeof projects)(projects)
        : update as typeof projects;
    },
    setMessage: (message: string) => { messages.push(message); },
    setError: (message: string) => { errors.push(message); },
    setBusy: () => { /* не проверяем */ },
    load: (value: unknown, exists: boolean) => { loads.push({ project: value, exists }); },
    takeSnapshot: async (reason: string) => { snapshotReasons.push(reason); },
  } as unknown as WorkspaceState;
  return { state, loads, saved, persisted, messages, errors, snapshotReasons };
}

const projectsInStorage = async (): Promise<Project[]> => listStoredProjects();

test('useProjectIo: staticMode saveProject кладёт проект в хранилище и в снимок', async () => {
  const project = baseProject({ id: 'io-save', name: 'Сохранение' });
  const h = harness(project);
  const io = useProjectIo(h.state);

  const result = await io.saveProject();

  assert.equal(result.name, 'Сохранение');
  const list = (await projectsInStorage()).filter(item => item.id === 'io-save');
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Сохранение');
  assert.deepEqual(h.saved, [JSON.stringify(project)]);
  assert.deepEqual(h.persisted, [true]);
  assert.deepEqual(h.messages, ['Проект «Сохранение» сохранён в браузере']);
  assert.deepEqual(h.snapshotReasons, ['ручное сохранение'], 'каждое ручное сохранение делает снимок');

  // silent-режим (автосохранение) не пишет сообщение и не плодит снимки.
  h.state.projectRef.current.name = 'Сохранение 2';
  await io.saveProject(true);
  const updated = (await projectsInStorage()).filter(item => item.id === 'io-save');
  assert.equal(updated.length, 1, 'проект обновляется, а не дублируется');
  assert.equal(updated[0].name, 'Сохранение 2');
  assert.deepEqual(h.messages, ['Проект «Сохранение» сохранён в браузере']);
  assert.deepEqual(h.snapshotReasons, ['ручное сохранение']);
});

test('useProjectIo: staticMode restoreProjectFile кладёт PDF/фото в IndexedDB и грузит проект', async () => {
  const project = baseProject({
    id: 'io-restore',
    name: 'Импорт',
    floors: [floor('f1', { pdfId: 'srv-pdf' })],
    equipment: [device('e1', 0, { photos: ['old-photo'] })],
  });
  const payload = {
    project,
    pdfs: [{ id: 'srv-pdf', name: 'plan.pdf', dataBase64: Buffer.from('PDF-BYTES').toString('base64') }],
    photos: [{ key: 'old-photo', name: 'photo.jpg', mime: 'image/jpeg', dataBase64: Buffer.from('PHOTO-BYTES').toString('base64') }],
  };
  const file = new File([JSON.stringify(payload)], 'import.anooplan', { type: 'application/vnd.anooplan.project' });
  const h = harness(baseProject({ id: 'io-restore-current', name: 'Текущий' }));
  const io = useProjectIo(h.state);

  let pdfKey: string | undefined;
  let photoKey: string | undefined;
  try {
    await io.restoreProjectFile(file);

    assert.equal(h.loads.length, 1);
    assert.equal(h.loads[0].exists, true, 'импортированный проект считается существующим');
    const loaded = h.loads[0].project as Project;
    assert.equal(loaded.id, 'io-restore');
    assert.equal(loaded.name, 'Импорт');

    pdfKey = loaded.floors[0].pdfId;
    assert.ok(pdfKey?.startsWith('idb:'), 'PDF переложен под новый локальный ключ');
    const pdf = await idbGet(pdfKey!.slice(4));
    assert.ok(pdf, 'PDF-блоб лежит в IndexedDB');
    assert.equal(await pdf!.text(), 'PDF-BYTES');

    photoKey = loaded.equipment[0].photos?.[0];
    assert.ok(photoKey && photoKey !== 'old-photo', 'фото получило новый ключ');
    assert.ok(!photoKey!.startsWith('photo:'), 'в проекте хранится ключ без префикса');
    const photo = await idbGet('photo:' + photoKey);
    assert.ok(photo, 'фото-блоб лежит в IndexedDB');
    assert.equal(await photo!.text(), 'PHOTO-BYTES');

    assert.deepEqual(h.messages, ['Проект загружен из файла.']);
    assert.deepEqual(h.errors, []);
  } finally {
    if (pdfKey) await idbDelete(pdfKey.slice(4));
    if (photoKey) await idbDelete('photo:' + photoKey);
  }
});

test('useProjectIo: staticMode deleteProject удаляет проект со снимками и грузит freshProject', async () => {
  const open = baseProject({ id: 'io-open', name: 'Открытый' });
  const other = baseProject({ id: 'io-other', name: 'Другой' });
  localStorage.setItem(PROJECTS_KEY, JSON.stringify([open, other]));

  const openSnapshot: SnapshotEntry = { key: 'io-open:111', createdAt: '2026-01-01T00:00:00Z', reason: 'старый', project: open };
  const otherSnapshot: SnapshotEntry = { key: 'io-other:222', createdAt: '2026-01-01T00:00:00Z', reason: 'чужой', project: other };
  await idbStorePut('snapshots', openSnapshot.key, openSnapshot);
  await idbStorePut('snapshots', otherSnapshot.key, otherSnapshot);

  const h = harness(open);
  const io = useProjectIo(h.state);
  try {
    await io.deleteProject('io-open', 'Открытый');

    assert.deepEqual((await projectsInStorage()).filter(item => item.id === 'io-open' || item.id === 'io-other').map(item => item.id), ['io-other']);
    assert.equal(await idbStoreGet<SnapshotEntry>('snapshots', openSnapshot.key), undefined, 'снимки удалённого проекта убраны');
    assert.ok(await idbStoreGet<SnapshotEntry>('snapshots', otherSnapshot.key), 'снимки чужого проекта не тронуты');
    const snapshotKeys = await idbStoreKeys('snapshots');
    assert.ok(!snapshotKeys.some(key => key.startsWith('io-open:')), 'не осталось снимков с ключом удалённого проекта');

    assert.equal(h.loads.length, 1, 'открытый проект заменён пустым');
    assert.equal(h.loads[0].exists, false);
    const fresh = h.loads[0].project as Project;
    assert.notEqual(fresh.id, 'io-open');
    assert.equal(fresh.name, 'Новый проект');
    assert.deepEqual(h.saved, [JSON.stringify(fresh)], 'пустой проект не считается грязным');
    assert.deepEqual(h.messages, ['Проект «Открытый» удалён.']);
  } finally {
    await idbStoreDelete('snapshots', otherSnapshot.key);
  }
});
