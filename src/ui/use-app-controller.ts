import { useAppEffects } from './use-app-effects';
import { useExport } from './use-export';
import { useObjectActions } from './use-object-actions';
import { usePlanEditing } from './use-plan-editing';
import { useProjectIo } from './use-project-io';
import { useWorkspaceState } from './use-workspace-state';
import { AUTO_BACKUP_EVERY, bumpSaveCounter, isBackupDue } from '../auto-backup';
import { logDiagnostic } from '../diagnostics';

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
  // 3.0.0: каждое N-е ручное сохранение в браузерном режиме сопровождается
  // автоматической выгрузкой .anooplan — копия уезжает из хранилища в файл.
  async function saveProject(silent = false) {
    const saved = await io.saveProject(silent);
    if (!silent && state.staticMode && isBackupDue(bumpSaveCounter(saved.id))) {
      try {
        await exports.saveAnoPlan();
        state.setMessage(`Сохранено. Автоматическая резервная копия .anooplan выгружена (каждое ${AUTO_BACKUP_EVERY}-е сохранение).`);
      } catch (error) {
        logDiagnostic('error', error, 'auto-backup');
      }
    }
    return saved;
  }
  return { ...state, ...io, ...plan, ...objects, ...exports, saveProject };
}

export type AppUi = ReturnType<typeof useAppController>;
