import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import React from 'react';
import { createRoot } from 'react-dom/client';
import type { Project } from '../src/model';
import type { SnapshotEntry } from '../src/use-snapshots';
import { useSnapshots } from '../src/use-snapshots';
import { idbStoreDelete, idbStoreGet, idbStoreKeys, idbStorePut } from '../src/idb';
import { projectSnapshotKeys } from '../src/snapshot-key';
import { baseProject } from './fixtures';

/**
 * Прямые тесты хука useSnapshots: рендерим его через react-dom в happy-dom,
 * а хранилище — настоящий fake-indexeddb (одна БД на процесс, не закрываем).
 */

type HookApi = ReturnType<typeof useSnapshots>;

interface Calls {
  load: { project: unknown; exists: boolean }[];
  errors: string[];
  messages: string[];
  saved: string[];
  gc: number;
}

interface Mounted {
  hook: () => HookApi;
  act: (fn: () => unknown) => Promise<void>;
  calls: Calls;
  projectRef: { current: Project };
  close: () => Promise<void>;
}

async function mount(project: Project): Promise<Mounted> {
  const window = new Window({ url: 'http://localhost/' });
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  (window as unknown as { confirm: (message?: string) => boolean }).confirm = () => true;

  const calls: Calls = { load: [], errors: [], messages: [], saved: [], gc: 0 };
  const projectRef = { current: project };
  let api: HookApi | null = null;

  function Probe() {
    api = useSnapshots({
      projectRef,
      load: (value, exists) => { calls.load.push({ project: value, exists }); },
      onGarbageCollect: () => { calls.gc += 1; },
      setError: message => { calls.errors.push(message); },
      setMessage: message => { calls.messages.push(message); },
      setSaved: value => { calls.saved.push(value); },
    });
    return null;
  }

  const container = window.document.createElement('div') as unknown as Parameters<typeof createRoot>[0];
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(Probe)); });

  return {
    hook: () => {
      assert.ok(api);
      return api;
    },
    act: async fn => { await React.act(async () => { await fn(); }); },
    calls,
    projectRef,
    close: async () => {
      await React.act(async () => { root.unmount(); });
      window.close();
    },
  };
}

/** Подменить IndexedDB на фабрику, чьи запросы падают: имитируем закрытое хранилище. */
function failingIndexedDb(): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const factory = {
    open() {
      const request: Record<string, unknown> = {};
      queueMicrotask(() => {
        request.error = new Error('хранилище недоступно');
        (request.onerror as (() => void) | undefined)?.();
      });
      return request;
    },
  };
  Object.defineProperty(globalThis, 'indexedDB', { value: factory, configurable: true, writable: true });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  };
}

// Тесты с ошибкой хранилища идут первыми: соединение idb ещё не открыто,
// поэтому подменённая фабрика действительно используется.
test('useSnapshots: ошибка takeSnapshot отменяет восстановление', async () => {
  const id = `snap-fail-${Date.now()}`;
  const project = baseProject({ id, name: 'Текущий' });
  const mounted = await mount(project);
  const entry: SnapshotEntry = {
    key: `${id}:1`,
    createdAt: '2026-01-01T00:00:00Z',
    reason: 'вручную',
    project: baseProject({ id, name: 'Старый' }),
  };
  await mounted.act(() => mounted.hook().setSnapshots([entry]));

  const restore = failingIndexedDb();
  try {
    await mounted.act(() => mounted.hook().restoreSnapshot(entry.key));
  } finally {
    restore();
  }

  assert.equal(mounted.calls.load.length, 0, 'load не должен вызываться');
  assert.equal(mounted.calls.saved.length, 0);
  assert.equal(mounted.calls.messages.length, 0);
  assert.match(mounted.calls.errors[0] ?? '', /Не удалось сохранить текущее состояние/);
  assert.match(mounted.calls.errors[0] ?? '', /Восстановление отменено/);
  assert.equal(mounted.hook().historyOpen, false);
  await mounted.close();
});

test('useSnapshots: openHistory сообщает об ошибке хранилища и отдаёт пустой список', async () => {
  const mounted = await mount(baseProject({ id: `snap-open-fail-${Date.now()}` }));

  const restore = failingIndexedDb();
  try {
    await mounted.act(() => mounted.hook().openHistory());
  } finally {
    restore();
  }

  assert.equal(mounted.hook().historyOpen, true);
  assert.deepEqual(mounted.hook().snapshots, []);
  assert.match(mounted.calls.errors[0] ?? '', /История версий недоступна/);
  assert.equal(mounted.calls.load.length, 0);
  await mounted.close();
});

test('useSnapshots: takeSnapshot пишет снимок проекта и держит лимит 20', async () => {
  const project = baseProject({ id: `snap-limit-${Date.now()}`, name: 'Лимит' });
  const mounted = await mount(project);

  const realNow = Date.now;
  const base = realNow();
  // Часы заморожены: React и happy-dom тоже зовут Date.now, поэтому время
  // сдвигаем сами — по шагу на снимок, иначе ключи сольются в одну миллисекунду.
  let now = base;
  const keys = await (async () => {
    Date.now = () => now;
    try {
      await mounted.act(async () => {
        for (let index = 0; index < 21; index += 1) {
          now = base + index + 1;
          await mounted.hook().takeSnapshot(`снимок ${index + 1}`);
        }
      });
      return projectSnapshotKeys(await idbStoreKeys('snapshots'), project.id);
    } finally {
      Date.now = realNow;
    }
  })();

  assert.equal(keys.length, 20, 'должно остаться ровно 20 снимков');
  assert.equal(keys[0], `${project.id}:${base + 21}`, 'свежий снимок первый');
  assert.ok(!keys.includes(`${project.id}:${base + 1}`), 'самый старый снимок удалён');

  const newest = await idbStoreGet<SnapshotEntry>('snapshots', keys[0]);
  assert.equal(newest?.key, keys[0]);
  assert.equal(newest?.reason, 'снимок 21');
  assert.equal(newest?.project.id, project.id);
  assert.equal(typeof newest?.createdAt, 'string');

  await mounted.act(() => mounted.hook().openHistory());
  assert.equal(mounted.hook().historyOpen, true);
  assert.equal(mounted.hook().snapshots?.length, 20);
  assert.equal(mounted.hook().snapshots?.[0]?.key, keys[0]);

  for (const key of keys) await idbStoreDelete('snapshots', key);
  await mounted.close();
});

test('useSnapshots: restoreSnapshot клонирует проект и помечает его несохранённым', async () => {
  const id = `snap-restore-${Date.now()}`;
  const mounted = await mount(baseProject({ id, name: 'Текущий' }));
  const saved = baseProject({ id, name: 'Снимок', updatedAt: '2026-01-02T00:00:00Z' });
  const entry: SnapshotEntry = { key: `${id}:10`, createdAt: '2026-01-01T00:00:00Z', reason: 'вручную', project: saved };
  await mounted.act(() => mounted.hook().setSnapshots([entry]));

  await mounted.act(() => mounted.hook().restoreSnapshot(entry.key));

  assert.equal(mounted.calls.load.length, 1);
  assert.equal(mounted.calls.load[0].exists, true);
  const loaded = mounted.calls.load[0].project as Project;
  assert.equal(loaded.name, 'Снимок');
  assert.notEqual(loaded, saved, 'восстанавливается копия, а не объект снимка');
  assert.deepEqual(loaded, saved);
  assert.deepEqual(mounted.calls.saved, [''], 'восстановленный проект снова грязный');
  assert.deepEqual(mounted.calls.messages, ['Проект восстановлен из снимка.']);
  assert.equal(mounted.hook().historyOpen, false);
  assert.equal(mounted.hook().snapshots, null);

  const written = projectSnapshotKeys(await idbStoreKeys('snapshots'), id);
  for (const key of written) await idbStoreDelete('snapshots', key);
  await mounted.close();
});

test('useSnapshots: deleteSnapshot удаляет снимок и запускает GC', async () => {
  const id = `snap-delete-${Date.now()}`;
  const mounted = await mount(baseProject({ id }));
  const first: SnapshotEntry = { key: `${id}:1`, createdAt: '2026-01-01T00:00:00Z', reason: 'первый', project: baseProject({ id }) };
  const second: SnapshotEntry = { key: `${id}:2`, createdAt: '2026-01-01T00:00:01Z', reason: 'второй', project: baseProject({ id }) };
  await idbStorePut('snapshots', first.key, first);
  await idbStorePut('snapshots', second.key, second);
  await mounted.act(() => mounted.hook().setSnapshots([first, second]));

  await mounted.act(() => mounted.hook().deleteSnapshot(first.key));

  assert.equal(await idbStoreGet<SnapshotEntry>('snapshots', first.key), undefined);
  assert.ok(await idbStoreGet<SnapshotEntry>('snapshots', second.key), 'чужой снимок остаётся');
  assert.deepEqual(mounted.hook().snapshots?.map(item => item.key), [second.key]);
  assert.equal(mounted.calls.gc, 1, 'onGarbageCollect вызван один раз');

  await idbStoreDelete('snapshots', second.key);
  await mounted.close();
});
