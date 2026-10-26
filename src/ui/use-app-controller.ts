import { useAppEffects } from './use-app-effects';
import { useExport } from './use-export';
import { useObjectActions } from './use-object-actions';
import { usePlanEditing } from './use-plan-editing';
import { useProjectIo } from './use-project-io';
import { useWorkspaceState } from './use-workspace-state';

/**
 * Единая точка входа для App: состояние, действия и эффекты рабочего пространства.
 * Возвращает один типизированный объект, который передаётся экранам и панелям.
 */
export function useAppController() {
  const state = useWorkspaceState();
  const io = useProjectIo(state);
  const plan = usePlanEditing(state);
  const objects = useObjectActions(state);
  const exports = useExport(state, io);
  useAppEffects(state, io, plan, objects);
  return { ...state, ...io, ...plan, ...objects, ...exports };
}

export type AppUi = ReturnType<typeof useAppController>;
