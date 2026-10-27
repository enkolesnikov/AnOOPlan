import type { Project } from '../model';
import { ANOOPLAN_EXTENSION, parseAnoPlanFile } from '../project-file';
import { createUuid as uid, cloneValue as clone } from '../compat';
import { logDiagnostic } from '../diagnostics';
import { idbDelete, idbPut, idbStoreDelete, idbStoreKeys } from '../idb';
import { deleteLocalProject, readLocalProjects, saveLocalProject } from '../local-projects';
import { migrateProject } from '../migrations';
import { api, jsonOptions } from './api';
import { nativeBridge } from './native';
import type { WorkspaceState } from './use-workspace-state';

/** Загрузка, сохранение, удаление и восстановление проекта: сервер и офлайн-браузер. */
export function useProjectIo(s: WorkspaceState) {
  const {
    projectRef, staticMode, persisted, dirty, dirtyRef,
    setPersisted, setSaved, setProject, setProjects, setMessage, setError, setBusy,
    load, takeSnapshot,
  } = s;
  async function run(task: () => Promise<void>) { setBusy(true); setError(''); try { await task(); } catch (e) { logDiagnostic('error', e, 'run'); setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  async function saveProject(silent = false): Promise<Project> {
    const snapshot = clone(projectRef.current);
    if (staticMode) {
      saveLocalProject(snapshot); setPersisted(true); setSaved(JSON.stringify(snapshot));
      if (!silent) {
        setMessage(`Проект «${snapshot.name}» сохранён в браузере`);
        void takeSnapshot('ручное сохранение').catch(() => { /* история недоступна */ });
      }
      return snapshot;
    }
    const result = await api<Project>(persisted ? `/api/projects/${snapshot.id}` : '/api/projects', jsonOptions(persisted ? 'PUT' : 'POST', snapshot));
    setPersisted(true); setSaved(JSON.stringify(result));
    if (JSON.stringify(projectRef.current) === JSON.stringify(snapshot)) { setProject(result); projectRef.current = result; }
    if (!silent) setMessage(`Проект «${result.name}» сохранён`);
    return result;
  }
  async function deleteProject(id: string, name: string) {
    if (!window.confirm(`Удалить проект «${name}»? Это действие необратимо.`)) return;
    if (staticMode) {
      // Снимки принадлежат проекту: без их удаления блобы PDF/фото останутся сиротами.
      try {
        const snapshotKeys = (await idbStoreKeys('snapshots')).filter(key => key.startsWith(id + ':'));
        for (const key of snapshotKeys) { try { await idbStoreDelete('snapshots', key); } catch { /* хранилище недоступно */ } }
      } catch { /* хранилище недоступно — проект всё равно удаляем */ }
      const target = readLocalProjects().find(p => p.id === id);
      if (target) for (const f of target.floors) if (f.pdfId?.startsWith('idb:')) { try { await idbDelete(f.pdfId.slice(4)); } catch { /* хранилище недоступно */ } }
      if (target) for (const item of [...target.equipment, ...(target.pins ?? [])]) for (const key of item.photos || []) { try { await idbDelete('photo:' + key); } catch { /* хранилище недоступно */ } }
      deleteLocalProject(id);
    } else await api('/api/projects/' + id, { method: 'DELETE' });
    setProjects(list => list ? list.filter(p => p.id !== id) : null);
    setMessage(`Проект «${name}» удалён.`);
  }
  function mayLeave() { return !dirty || window.confirm('Есть несохранённые изменения. Продолжить без сохранения?'); }

  async function restoreProjectFile(file: File): Promise<void> {
    const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
    if (staticMode) {
      const hasProject = Boolean(parsed) && typeof parsed === 'object' && 'project' in parsed;
      const project = migrateProject(hasProject ? parsed.project : parsed);
      if (hasProject) {
        const rawPdfs = Array.isArray(parsed.pdfs) ? parsed.pdfs as { id?: string; dataBase64?: string }[] : [];
        for (const pdf of rawPdfs) {
          if (pdf?.id && pdf.dataBase64) {
            const bytes = Uint8Array.from(atob(pdf.dataBase64), c => c.charCodeAt(0));
            await idbPut(pdf.id.replace(/^idb:/, ''), new Blob([bytes], { type: 'application/pdf' }));
          }
        }
        const rawPhotos = Array.isArray(parsed.photos) ? parsed.photos as { key?: string; dataBase64?: string; mime?: string }[] : [];
        for (const photo of rawPhotos) {
          if (photo?.key && photo.dataBase64) {
            const bytes = Uint8Array.from(atob(photo.dataBase64), c => c.charCodeAt(0));
            await idbPut('photo:' + photo.key, new Blob([bytes], { type: photo.mime || 'image/jpeg' }));
          }
        }
      }
      load(project, true);
      setMessage('Проект загружен из файла.');
      return;
    }
    if (parsed && typeof parsed === 'object' && 'project' in parsed) {
      const result = await api<Project>('/api/restore', jsonOptions('POST', parsed));
      load(result, true);
      setMessage('Резервная копия с PDF восстановлена.');
      return;
    }
    load(parsed, false);
    setMessage('Проект загружен из файла. Подложку PDF при необходимости загрузите заново.');
  }

  async function openSharedProject(text: string): Promise<void> {
    try {
      const parsed = parseAnoPlanFile(JSON.parse(text));
      if (dirtyRef.current && !window.confirm('Есть несохранённые изменения. Открыть файл без сохранения?')) {
        setMessage('Открытие файла отменено.');
        return;
      }
      const lost: string[] = [];
      if (parsed.kind === 'file') {
        // Вложения всегда сохраняем под новыми локальными ключами: файл мог прийти
        // с другого устройства или из серверного режима, поэтому старые id не переиспользуем.
        const pdfKeys = new Map<string, string>();
        for (const pdf of parsed.pdfs) {
          if (!pdf?.id || !pdf.dataBase64) continue;
          const bytes = (() => {
            try { return Uint8Array.from(atob(pdf.dataBase64), c => c.charCodeAt(0)); } catch { return null; }
          })();
          if (!bytes) continue;
          const pdfBlob = new Blob([bytes], { type: 'application/pdf' });
          if (!staticMode) {
            // Серверный режим: PDF снова загружаем в хранилище сервера, чтобы проект
            // оставался переносимым, а резервные копии включали подложку.
            try {
              const form = new FormData();
              form.append('file', new File([pdfBlob], 'plan.pdf', { type: 'application/pdf' }));
              const uploaded = await api<{ id: string }>('/api/pdfs', { method: 'POST', body: form });
              pdfKeys.set(pdf.id, uploaded.id);
              continue;
            } catch { /* сервер недоступен — сохраним PDF локально */ }
          }
          try {
            const localKey = uid();
            await idbPut(localKey, pdfBlob);
            pdfKeys.set(pdf.id, 'idb:' + localKey);
          } catch (error) { logDiagnostic('error', error, 'attach-pdf'); lost.push('PDF'); /* проект открываем, но потерю покажем */ }
        }
        if (pdfKeys.size) {
          for (const stageFloor of parsed.project.floors) {
            if (stageFloor.pdfId && pdfKeys.has(stageFloor.pdfId)) stageFloor.pdfId = pdfKeys.get(stageFloor.pdfId)!;
          }
        }
        for (const photo of parsed.photos) {
          if (!photo?.key || !photo.dataBase64) continue;
          try {
            const bytes = Uint8Array.from(atob(photo.dataBase64), c => c.charCodeAt(0));
            await idbPut('photo:' + photo.key, new Blob([bytes], { type: photo.mime || 'image/jpeg' }));
          } catch (error) { logDiagnostic('error', error, 'attach-photo'); lost.push('фото'); /* проект открываем, но потерю покажем */ }
        }
        // Открытый файл ещё не сохранён в хранилище: persisted=false, чтобы «Сохранить»
        // создавал проект, а не делал PUT /api/projects/<чужой id> (404).
        load(parsed.project, false);
      } else {
        load(parsed.project, false);
      }
      setMessage(`Проект «${parsed.project.name}» открыт из файла ${ANOOPLAN_EXTENSION}.`);
      if (lost.length) setError(`Проект открыт, но вложения не сохранились: ${lost.length} (${[...new Set(lost)].join(', ')}). Проверьте свободное место и повторите импорт.`);
    } catch (error) {
      logDiagnostic('error', error, 'openSharedProject');
      setError(`Не удалось открыть файл ${ANOOPLAN_EXTENSION}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { load, run, saveProject, deleteProject, mayLeave, restoreProjectFile, openSharedProject };
}
export type ProjectIo = ReturnType<typeof useProjectIo>;
