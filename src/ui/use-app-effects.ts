import { useEffect, useRef } from 'react';
import type { Project } from '../model';
import { collectStorageGarbage } from '../garbage-collector';
import { logDiagnostic } from '../diagnostics';
import { nativeBridge } from './native';
import type { PlanEditing } from './use-plan-editing';
import type { ProjectIo } from './use-project-io';
import type { WorkspaceState } from './use-workspace-state';

/** Жизненный цикл приложения: автосохранение, снимки, уборка, нативный мост и горячие клавиши. */
export function useAppEffects(
  s: WorkspaceState,
  io: ProjectIo,
  plan: PlanEditing,
  objects: { copySelection: () => void; removeSelection: () => void },
) {
  const {
    dirty, dirtyRef, project, projectRef, staticMode, setStaticMode, floor, persisted,
    draft, setDraft, setCalibration, setMeasure, setCableSegments, setTool,
    undo, redo, history, setMessage, load, takeSnapshot, selection, gridSize, mutate, setMenuOpen,
  } = s;
  const { saveProject, run, openSharedProject } = io;
  const { finishRoute, fit } = plan;
  const { copySelection, removeSelection } = objects;
  // Нестабильные функции из соседних хуков не должны перезапускать эффекты.
  const saveProjectRef = useRef(saveProject); saveProjectRef.current = saveProject;
  const takeSnapshotRef = useRef(takeSnapshot); takeSnapshotRef.current = takeSnapshot;
  const loadRef = useRef(load); loadRef.current = load;
  const openSharedProjectRef = useRef(openSharedProject); openSharedProjectRef.current = openSharedProject;
  const setMessageRef = useRef(setMessage); setMessageRef.current = setMessage;
  useEffect(() => { const handler = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, [dirty]);
  useEffect(() => { setDraft([]); setCalibration([]); setMeasure([]); }, [floor?.id, floor?.pdfId, setDraft, setCalibration, setMeasure]);
  useEffect(() => { fetch('/api/health').then(r => { if (!r.ok) setStaticMode(true); }).catch(() => setStaticMode(true)); }, [setStaticMode]);
  useEffect(() => {
    if (!staticMode) return;
    const timer = setTimeout(() => { try { localStorage.setItem('cableplan:autosave', JSON.stringify(projectRef.current)); } catch { /* переполнение localStorage */ } }, 800);
    return () => clearTimeout(timer);
  }, [project, staticMode, projectRef]);
  // Проект, который уже лежит в списке, дописывается сам — «Сохранить» лишь для нового.
  useEffect(() => {
    if (!dirty || !persisted) return;
    const timer = setTimeout(() => { void saveProjectRef.current(true).catch(error => { logDiagnostic('error', error, 'autosave'); /* повторим при следующем изменении */ }); }, 1500);
    return () => clearTimeout(timer);
  }, [dirty, project, persisted]);
  // Снимок версии: раз в пять минут при несохранённых изменениях и перед восстановлением.
  useEffect(() => {
    const timer = setInterval(() => { if (dirty) void takeSnapshotRef.current('автоснимок').catch(() => { /* хранилище недоступно */ }); }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [dirty]);
  // Фоновая уборка осиротевших PDF/фото. Учитывает историю и снимки, поэтому
  // не ломает undo; запускается после затишья, чтобы не мешать правкам.
  useEffect(() => {
    if (!staticMode) return;
    const timer = setTimeout(() => { void collectStorageGarbage([projectRef.current, ...undo, ...redo]); }, 3000);
    return () => clearTimeout(timer);
  }, [project, undo, redo, staticMode, projectRef]);
  // Нативная оболочка спрашивает, есть ли несохранённые изменения (кнопка/жест «Назад»).
  useEffect(() => { nativeBridge()?.setDirty?.(dirty); }, [dirty]);
  // Вызывается из Java: сохранить и только потом закрыть приложение.
  useEffect(() => {
    (window as Window & { __anooplanSaveAndExit?: () => Promise<void> }).__anooplanSaveAndExit = async () => {
      try { await saveProject(true); } catch (error) { logDiagnostic('error', error, 'saveAndExit'); /* выходим в любом случае */ }
      nativeBridge()?.exitNow?.();
    };
  });
  // Открытие .anooplan из системы: Java вызывает __anooplanOpenSharedProject(jsonText)
  // и/или отдаёт отложенный файл через мост при запуске.
  useEffect(() => {
    const target = window as Window & { __anooplanOpenSharedProject?: (text: string) => void };
    target.__anooplanOpenSharedProject = (text: string) => { void openSharedProjectRef.current(text); };
    const pending = nativeBridge()?.takePendingFile?.();
    if (pending) void openSharedProjectRef.current(pending);
    return () => { delete target.__anooplanOpenSharedProject; };
  }, []);
  useEffect(() => {
    if (!staticMode) return;
    try {
      const raw = localStorage.getItem('cableplan:autosave');
      if (!raw) return;
      const saved = JSON.parse(raw) as Project;
      if (saved && (saved.schemaVersion === 1 || saved.schemaVersion === 2) && Array.isArray(saved.floors) && projectRef.current.name === 'Новый проект' && projectRef.current.equipment.length === 0) {
        loadRef.current(saved, true); setMessageRef.current('Восстановлен последний черновик из браузера.');
      }
    } catch { /* ignore */ }
  }, [staticMode, projectRef]);
  useEffect(() => {
    const tools = ['select', 'pan', 'equipment', 'route', 'dimension', 'cable', 'calibrate', 'measure'] as const;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input,select,textarea')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); void run(async () => { await saveProject(); }); return; }
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); history(!e.shiftKey); return; }
      if (ctrl && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMenuOpen(true);
        window.dispatchEvent(new Event('cableplan:focus-search'));
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); copySelection(); return; }
      if (e.key === 'Delete') { e.preventDefault(); removeSelection(); return; }
      if (e.key.toLowerCase() === 'f') { e.preventDefault(); fit(); return; }
      if (/^[1-8]$/.test(e.key)) { setTool(tools[Number(e.key) - 1]); return; }
      if (e.key.startsWith('Arrow') && selection !== null && (selection.kind === 'equipment' || selection.kind === 'pin')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : Math.max(1, gridSize);
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        mutate(p => {
          const item = selection.kind === 'equipment'
            ? p.equipment.find(entry => entry.id === selection.id)
            : p.pins.find(entry => entry.id === selection.id);
          if (item) { item.x += dx; item.y += dy; }
        }, 'Сдвиг');
        return;
      }
      if (e.key === 'Escape') { setDraft([]); setCalibration([]); setCableSegments([]); setMeasure([]); setTool('select'); }
      if (e.key === 'Enter' && draft.length > 1) finishRoute();
    }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
}
