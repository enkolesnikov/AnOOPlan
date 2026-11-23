import type { Project } from '../model';
import { ANOOPLAN_EXTENSION, parseAnoPlanFile } from '../project-file';
import { createUuid as uid, cloneValue as clone } from '../compat';
import { logDiagnostic } from '../diagnostics';
import { idbDelete, idbPut, idbStoreDelete, idbStoreKeys } from '../idb';
import { deleteStoredProject, saveStoredProject } from '../project-store';
import { resetSaveCounter } from '../auto-backup';
import { migrateProject } from '../migrations';
import { collectStorageGarbage } from '../garbage-collector';
import { verifyAttachmentManifest, type AttachmentManifest } from '../attachment-manifest';
import { snapshotProjectId } from '../snapshot-key';
import { api, jsonOptions } from './api';
import { freshProject } from './project-factory';
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
      await saveStoredProject(snapshot); setPersisted(true); setSaved(JSON.stringify(snapshot));
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
        // Сравниваем разобранный id, а не префикс: «a» не должно удалять снимки «a:b».
        const snapshotKeys = (await idbStoreKeys('snapshots')).filter(key => snapshotProjectId(key) === id);
        for (const key of snapshotKeys) { try { await idbStoreDelete('snapshots', key); } catch { /* хранилище недоступно */ } }
      } catch { /* хранилище недоступно — проект всё равно удаляем */ }
      // Блобы не удаляем здесь: GC проверит оставшиеся проекты, undo и снимки.
      await deleteStoredProject(id);
      resetSaveCounter(id);
      void collectStorageGarbage([projectRef.current]);
    } else await api('/api/projects/' + id, { method: 'DELETE' });
    setProjects(list => list ? list.filter(p => p.id !== id) : null);
    // Удалённый открытый проект нельзя оставлять в памяти: автосохранение
    // через 1,5 с записало бы его обратно в список.
    if (id === projectRef.current.id) {
      const fresh = freshProject();
      load(fresh, false);
      // Новый пустой проект ещё не меняли: не просим сохранить пустышку при выходе.
      setSaved(JSON.stringify(fresh));
    }
    setMessage(`Проект «${name}» удалён.`);
  }
  function mayLeave() { return !dirty || window.confirm('Есть несохранённые изменения. Продолжить без сохранения?'); }

  async function restoreProjectFile(file: File): Promise<void> {
    const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
    if (staticMode) {
      const hasProject = Boolean(parsed) && typeof parsed === 'object' && 'project' in parsed;
      const project = migrateProject(hasProject ? parsed.project : parsed);
      if (hasProject) {
        if (parsed.manifest && typeof parsed.manifest === 'object') {
          const rawPdfs = Array.isArray(parsed.pdfs) ? parsed.pdfs as { id: string; name: string; dataBase64: string }[] : [];
          const rawPhotos = Array.isArray(parsed.photos) ? parsed.photos as { key: string; name: string; mime: string; dataBase64: string }[] : [];
          await verifyAttachmentManifest(parsed.manifest as AttachmentManifest, rawPdfs, rawPhotos);
        }
        const rawPdfs = Array.isArray(parsed.pdfs) ? parsed.pdfs as { id?: string; dataBase64?: string }[] : [];
        const pdfKeys = new Map<string, string>();
        for (const pdf of rawPdfs) {
          if (pdf?.id && pdf.dataBase64) {
            const bytes = Uint8Array.from(atob(pdf.dataBase64), c => c.charCodeAt(0));
            const localKey = uid();
            await idbPut(localKey, new Blob([bytes], { type: 'application/pdf' }));
            pdfKeys.set(pdf.id, 'idb:' + localKey);
          }
        }
        if (pdfKeys.size) {
          for (const stageFloor of project.floors) {
            if (stageFloor.pdfId && pdfKeys.has(stageFloor.pdfId)) stageFloor.pdfId = pdfKeys.get(stageFloor.pdfId)!;
          }
        }
        const rawPhotos = Array.isArray(parsed.photos) ? parsed.photos as { key?: string; dataBase64?: string; mime?: string }[] : [];
        const photoKeys = new Map<string, string>();
        for (const photo of rawPhotos) {
          if (photo?.key && photo.dataBase64) {
            const bytes = Uint8Array.from(atob(photo.dataBase64), c => c.charCodeAt(0));
            const localKey = uid();
            await idbPut('photo:' + localKey, new Blob([bytes], { type: photo.mime || 'image/jpeg' }));
            photoKeys.set(photo.key, localKey);
          }
        }
        if (photoKeys.size) {
          for (const item of [...project.equipment, ...(project.pins ?? [])]) {
            if (item.photos?.length) item.photos = item.photos.map(key => photoKeys.get(key) ?? key);
          }
        }
      }
      load(project, true);
      setMessage('Проект загружен из файла.');
      return;
    }
    if (parsed && typeof parsed === 'object' && 'project' in parsed) {
      if (parsed.manifest && typeof parsed.manifest === 'object') {
        await verifyAttachmentManifest(
          parsed.manifest as AttachmentManifest,
          Array.isArray(parsed.pdfs) ? parsed.pdfs as { id: string; name: string; dataBase64: string }[] : [],
          Array.isArray(parsed.photos) ? parsed.photos as { key: string; name: string; mime: string; dataBase64: string }[] : [],
        );
      }
      // Сервер хранит только PDF. Фото из .anooplan кладём в локальный IndexedDB
      // и переназначаем ключи до записи проекта, иначе они молча пропадут.
      const rawPhotos = Array.isArray(parsed.photos) ? parsed.photos as { key?: string; dataBase64?: string; mime?: string }[] : [];
      const lost: string[] = [];
      const photoKeys = new Map<string, string>();
      for (const photo of rawPhotos) {
        if (!photo?.key || !photo.dataBase64) { lost.push('фото'); continue; }
        try {
          const bytes = Uint8Array.from(atob(photo.dataBase64), c => c.charCodeAt(0));
          const localKey = uid();
          await idbPut('photo:' + localKey, new Blob([bytes], { type: photo.mime || 'image/jpeg' }));
          photoKeys.set(photo.key, localKey);
        } catch (error) { logDiagnostic('error', error, 'restore-photo'); lost.push('фото'); }
      }
      const project = migrateProject(parsed.project);
      if (photoKeys.size) {
        for (const item of [...project.equipment, ...(project.pins ?? [])]) {
          if (item.photos?.length) item.photos = item.photos.map(key => photoKeys.get(key) ?? key);
        }
      }
      const manifest = parsed.manifest as AttachmentManifest | undefined;
      const pdfManifest = manifest ? { version: 1 as const, files: manifest.files.filter(entry => entry.kind === 'pdf') } : undefined;
      const payload = { ...parsed, project, photos: [], ...(pdfManifest ? { manifest: pdfManifest } : {}) };
      const result = await api<Project>('/api/restore', jsonOptions('POST', payload));
      load(result, true);
      setMessage('Резервная копия с PDF восстановлена.');
      if (lost.length) setError(`Проект восстановлен, но фото не сохранились: ${lost.length}. Проверьте свободное место и повторите импорт.`);
      return;
    }
    load(parsed, false);
    setMessage('Проект загружен из файла. Подложку PDF при необходимости загрузите заново.');
  }

  async function openSharedProject(text: string): Promise<void> {
    try {
      const parsed = parseAnoPlanFile(JSON.parse(text));
      if (parsed.kind === 'file' && parsed.manifest) await verifyAttachmentManifest(parsed.manifest, parsed.pdfs, parsed.photos);
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
          if (!pdf?.id || !pdf.dataBase64) { lost.push('PDF'); continue; }
          const bytes = (() => {
            try { return Uint8Array.from(atob(pdf.dataBase64), c => c.charCodeAt(0)); } catch { return null; }
          })();
          if (!bytes) { lost.push('PDF'); continue; }
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
        const photoKeys = new Map<string, string>();
        for (const photo of parsed.photos) {
          if (!photo?.key || !photo.dataBase64) continue;
          try {
            const bytes = Uint8Array.from(atob(photo.dataBase64), c => c.charCodeAt(0));
            const localKey = uid();
            await idbPut('photo:' + localKey, new Blob([bytes], { type: photo.mime || 'image/jpeg' }));
            photoKeys.set(photo.key, localKey);
          } catch (error) { logDiagnostic('error', error, 'attach-photo'); lost.push('фото'); /* проект открываем, но потерю покажем */ }
        }
        if (photoKeys.size) {
          for (const item of [...parsed.project.equipment, ...(parsed.project.pins ?? [])]) {
            if (item.photos?.length) item.photos = item.photos.map(key => photoKeys.get(key) ?? key);
          }
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
