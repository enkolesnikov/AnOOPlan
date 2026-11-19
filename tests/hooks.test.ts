import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import React from 'react';
import { createRoot } from 'react-dom/client';
import type { Project } from '../src/model';
import { freshProject } from '../src/ui/project-factory';
import { useProjectHistory } from '../src/use-project-history';
import { useSnapshots } from '../src/use-snapshots';
import { idbStoreDelete, idbStoreKeys } from '../src/idb';
import { projectSnapshotKeys } from '../src/snapshot-key';

/**
 * Прямой тест UI-хука: рендерим useProjectHistory через react-dom в happy-dom.
 * Проверяем склейку ввода, подписи шагов, undo/redo и восстановление проекта.
 */
test('useProjectHistory: склейка ввода, подписи и undo/redo', async () => {
  const window = new Window({ url: 'http://localhost/' });
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });

  let api: ReturnType<typeof useProjectHistory> | null = null;
  const projectRef = { current: freshProject() as Project };
  const initial = projectRef.current;

  function Probe() {
    const [project, setProject] = React.useState<Project>(projectRef.current);
    projectRef.current = project;
    api = useProjectHistory(
      projectRef,
      value => setProject(previous => {
        const next = typeof value === 'function' ? value(previous) : value;
        projectRef.current = next;
        return next;
      }),
      () => {},
      () => {},
    );
    return null;
  }

  const container = window.document.createElement('div') as unknown as Parameters<typeof createRoot>[0];
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(Probe)); });
  const hook = (): NonNullable<typeof api> => {
    assert.ok(api);
    return api;
  };
  assert.equal(hook().undo.length, 0);

  await React.act(async () => { hook().mutate(p => { p.name = 'П'; }, 'Правка поля'); });
  assert.equal(hook().undo.length, 1);
  assert.equal(hook().undoLabel, 'Правка поля');

  // Продолжение набора в окне склейки не создаёт новый шаг.
  await React.act(async () => { hook().mutate(p => { p.name = 'Проект'; }, 'Правка поля'); });
  assert.equal(hook().undo.length, 1);
  assert.equal(projectRef.current.name, 'Проект');

  // Другое действие — новый шаг.
  await React.act(async () => { hook().mutate(p => { p.name = 'Другой'; }, 'Дублирование'); });
  assert.equal(hook().undo.length, 2);
  assert.equal(hook().undoLabel, 'Дублирование');

  await React.act(async () => { hook().history(true); });
  assert.equal(projectRef.current.name, 'Проект');
  assert.equal(hook().redo.length, 1);
  assert.equal(hook().redoLabel, 'Дублирование');

  await React.act(async () => { hook().history(true); });
  assert.equal(projectRef.current.name, initial.name);

  await React.act(async () => { hook().history(false); });
  assert.equal(projectRef.current.name, 'Проект');

  await React.act(async () => { root.unmount(); });
  window.close();
});

/**
 * Связка useSnapshots и useProjectHistory: восстановленный снимок приходит
 * через load, а тот в рабочем пространстве сбрасывает историю правок.
 */
test('useSnapshots: восстановление снимка возвращает проект и сбрасывает историю', async () => {
  const window = new Window({ url: 'http://localhost/' });
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  (window as unknown as { confirm: (message?: string) => boolean }).confirm = () => true;

  const errors: string[] = [];
  const messages: string[] = [];
  const saved: string[] = [];
  const projectRef = { current: freshProject() as Project };
  let snapshotsApi: ReturnType<typeof useSnapshots> | null = null;
  let historyApi: ReturnType<typeof useProjectHistory> | null = null;

  function Probe() {
    const [project, setProject] = React.useState<Project>(projectRef.current);
    projectRef.current = project;
    const history = useProjectHistory(projectRef, setProject, message => errors.push(message), () => {});
    const snapshots = useSnapshots({
      projectRef,
      load: value => {
        const next = value as Project;
        setProject(next);
        projectRef.current = next;
        history.reset();
      },
      onGarbageCollect: () => {},
      setError: message => errors.push(message),
      setMessage: message => messages.push(message),
      setSaved: value => saved.push(value),
    });
    snapshotsApi = snapshots;
    historyApi = history;
    return null;
  }

  const container = window.document.createElement('div') as unknown as Parameters<typeof createRoot>[0];
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(Probe)); });
  const snapshots = (): NonNullable<typeof snapshotsApi> => {
    assert.ok(snapshotsApi);
    return snapshotsApi;
  };
  const history = (): NonNullable<typeof historyApi> => {
    assert.ok(historyApi);
    return historyApi;
  };

  await React.act(async () => { history().mutate(project => { project.name = 'Снимок'; }, 'Правка'); });
  await React.act(async () => { await snapshots().takeSnapshot('вручную'); });
  await React.act(async () => { history().mutate(project => { project.name = 'После'; }, 'Ещё правка'); });
  assert.equal(history().undo.length, 2);

  await React.act(async () => { await snapshots().openHistory(); });
  assert.equal(snapshots().snapshots?.length, 1);
  const key = snapshots().snapshots![0].key;

  await React.act(async () => { await snapshots().restoreSnapshot(key); });
  assert.equal(projectRef.current.name, 'Снимок');
  assert.equal(history().undo.length, 0, 'история правок сброшена загрузкой снимка');
  assert.equal(saved.at(-1), '', 'восстановленный снимок помечен несохранённым');
  assert.ok(messages.includes('Проект восстановлен из снимка.'));

  const projectId = projectRef.current.id;
  for (const snapshotKey of projectSnapshotKeys(await idbStoreKeys('snapshots'), projectId)) {
    await idbStoreDelete('snapshots', snapshotKey);
  }
  await React.act(async () => { root.unmount(); });
  window.close();
});
