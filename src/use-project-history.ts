import { useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Project } from './model';
import { cloneValue as clone } from './compat';
import { HISTORY_LIMIT, canCoalesce, pushLimited } from './ui/history';

/**
 * Undo/redo и изменение проекта: одна точка, где обновляется updatedAt и история.
 *
 * `label` задаёт подпись действия. Повторные изменения с той же подписью в окне
 * GROUP_WINDOW_MS (набор числа/текста) склеиваются в один шаг undo: Ctrl+Z
 * отменяет ввод целиком, а не по символу.
 */
export function useProjectHistory(
  projectRef: MutableRefObject<Project>,
  setProject: Dispatch<SetStateAction<Project>>,
  setError: (message: string) => void,
  onRestore: () => void,
) {
  const [undo, setUndo] = useState<Project[]>([]);
  const [redo, setRedo] = useState<Project[]>([]);
  const [undoLabels, setUndoLabels] = useState<string[]>([]);
  const [redoLabels, setRedoLabels] = useState<string[]>([]);
  const lastAction = useRef<{ label: string | undefined; at: number } | null>(null);

  function commit(next: Project | ((project: Project) => Project), label?: string): void {
    const previous = projectRef.current;
    const value = typeof next === 'function' ? next(clone(previous)) : next;
    const now = Date.now();
    const coalesce = canCoalesce(lastAction.current, label, now);
    if (!coalesce) {
      setUndo(items => pushLimited(items, clone(previous), HISTORY_LIMIT));
      setUndoLabels(items => pushLimited(items, label ?? 'Действие', HISTORY_LIMIT));
    }
    setRedo([]);
    setRedoLabels([]);
    lastAction.current = { label, at: now };
    value.updatedAt = new Date().toISOString();
    projectRef.current = value;
    setProject(value);
    setError('');
  }

  function mutate(fn: (project: Project) => void, label?: string): void {
    commit(project => { fn(project); return project; }, label);
  }

  function history(back: boolean): void {
    const source = back ? undo : redo;
    if (!source.length) return;
    const next = source[source.length - 1];
    const label = (back ? undoLabels : redoLabels).at(-1) ?? 'Действие';
    // Фиксируем текущее состояние до подмены projectRef: иначе state-updater
    // прочитает уже восстановленный проект и в противоположный стек попадёт не то.
    const current = clone(projectRef.current);
    if (back) {
      setUndo(source.slice(0, -1));
      setUndoLabels(items => items.slice(0, -1));
      setRedo(items => pushLimited(items, current, HISTORY_LIMIT));
      setRedoLabels(items => pushLimited(items, label, HISTORY_LIMIT));
    } else {
      setRedo(source.slice(0, -1));
      setRedoLabels(items => items.slice(0, -1));
      setUndo(items => pushLimited(items, current, HISTORY_LIMIT));
      setUndoLabels(items => pushLimited(items, label, HISTORY_LIMIT));
    }
    const restored = clone(next);
    setProject(restored);
    projectRef.current = restored;
    lastAction.current = null;
    onRestore();
  }

  function record(previous: Project, label = 'Загрузка'): void {
    setUndo(items => pushLimited(items, clone(previous), HISTORY_LIMIT));
    setUndoLabels(items => pushLimited(items, label, HISTORY_LIMIT));
    setRedo([]);
    setRedoLabels([]);
    lastAction.current = null;
  }

  function reset(): void {
    setUndo([]);
    setRedo([]);
    setUndoLabels([]);
    setRedoLabels([]);
    lastAction.current = null;
  }

  return {
    undo, redo, undoLabels, redoLabels,
    undoLabel: undoLabels.at(-1) ?? null,
    redoLabel: redoLabels.at(-1) ?? null,
    commit, mutate, history, reset, record,
  };
}
