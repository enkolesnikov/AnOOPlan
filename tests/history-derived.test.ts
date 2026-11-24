import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import React from 'react';
import { createRoot } from 'react-dom/client';
import type { Project } from '../src/model';
import { freshProject } from '../src/ui/project-factory';
import { useProjectHistory } from '../src/use-project-history';

/**
 * Страж разделения «данные/метаданные» (3.1.0): commit с `derived: false`
 * (например, правка названия проекта) не должен поднимать редакцию инженерных
 * данных — иначе validateProject/расчёты кабелей пересчитываются на каждый
 * символ (замер на 2000 сегментах: было ~100–200 мс на символ).
 * Тайминги в CI шумные, поэтому контракт проверяется детерминированно здесь,
 * а perf-спека ловит только грубый регресс.
 */
test('useProjectHistory: onDataChange различает данные и метаданные', async () => {
  const window = new Window({ url: 'http://localhost/' });
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });

  const calls: boolean[] = [];
  let api: ReturnType<typeof useProjectHistory> | null = null;
  const projectRef = { current: freshProject() as Project };

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
      derived => { calls.push(derived); },
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
  assert.deepEqual(calls, []);

  // Метаданные: название проекта — derived не поднимается.
  await React.act(async () => { hook().mutate(p => { p.name = 'Новое название'; }, undefined, { derived: false }); });
  assert.deepEqual(calls, [false]);

  // Обычная мутация (без options) — derived поднимается.
  await React.act(async () => { hook().mutate(p => { p.name = 'Ещё раз'; }, 'Переименование'); });
  assert.deepEqual(calls, [false, true]);

  // record (конец жеста перетаскивания) — derived поднимается.
  await React.act(async () => { hook().record(projectRef.current, 'Перетаскивание'); });
  assert.deepEqual(calls, [false, true, true]);

  // undo/redo — derived поднимается всегда (восстановление может вернуть данные).
  await React.act(async () => { hook().history(true); });
  await React.act(async () => { hook().history(false); });
  assert.deepEqual(calls, [false, true, true, true, true]);

  await React.act(async () => { root.unmount(); });
});
