import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import React from 'react';
import { createRoot } from 'react-dom/client';
import type { Project } from '../src/model';
import { freshProject } from '../src/ui/project-factory';
import { useProjectHistory } from '../src/use-project-history';

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
