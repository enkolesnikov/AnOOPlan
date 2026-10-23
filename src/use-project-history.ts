import { useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Project } from './model';
import { cloneValue as clone } from './compat';

/** Undo/redo и изменение проекта: одна точка, где обновляется updatedAt и история. */
export function useProjectHistory(
  projectRef: MutableRefObject<Project>,
  setProject: Dispatch<SetStateAction<Project>>,
  setError: (message: string) => void,
  onRestore: () => void,
) {
  const [undo, setUndo] = useState<Project[]>([]);
  const [redo, setRedo] = useState<Project[]>([]);

  function commit(next: Project | ((project: Project) => Project)): void {
    const previous = projectRef.current;
    const value = typeof next === 'function' ? next(clone(previous)) : next;
    setUndo(items => [...items.slice(-59), clone(previous)]);
    setRedo([]);
    value.updatedAt = new Date().toISOString();
    projectRef.current = value;
    setProject(value);
    setError('');
  }

  function mutate(fn: (project: Project) => void): void {
    commit(project => { fn(project); return project; });
  }

  function history(back: boolean): void {
    const source = back ? undo : redo;
    if (!source.length) return;
    const next = source[source.length - 1];
    if (back) {
      setUndo(source.slice(0, -1));
      setRedo(items => [...items, clone(projectRef.current)]);
    } else {
      setRedo(source.slice(0, -1));
      setUndo(items => [...items, clone(projectRef.current)]);
    }
    const restored = clone(next);
    setProject(restored);
    projectRef.current = restored;
    onRestore();
  }

  function record(previous: Project): void {
    setUndo(items => [...items.slice(-59), clone(previous)]);
    setRedo([]);
  }

  function reset(): void {
    setUndo([]);
    setRedo([]);
  }

  return { undo, redo, commit, mutate, history, reset, record };
}
