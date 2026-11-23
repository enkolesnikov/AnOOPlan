import type { Project } from './model';
import type { SnapshotEntry } from './use-snapshots';
import { idbDelete, idbStoreDelete, idbStoreGetAll, idbStoreKeys } from './idb';
import { readAutosaveDraft } from './local-projects';
import { listStoredProjects } from './project-store';
import { unusedStorageKeys } from './storage-gc';

/**
 * Убирает блобы, на которые больше не ссылается ни проект, ни undo/redo,
 * ни сохранённые проекты, ни снимки версий. Снимки удалённых проектов
 * тоже вычищаются: иначе они держат PDF и фото вечно.
 *
 * Черновик `cableplan:autosave` (другая вкладка / ещё не сохранённый импорт)
 * входит в живые состояния: иначе GC одной вкладки стирал вложения другой.
 */
export async function collectStorageGarbage(states: Project[]): Promise<void> {
  try {
    const saved = await listStoredProjects();
    const draft = readAutosaveDraft();
    const live = draft ? [...states, draft] : states;
    const projectIds = new Set([...live, ...saved].map(item => item.id));
    const snapshotProjects: Project[] = [];
    for (const entry of await idbStoreGetAll<SnapshotEntry>('snapshots')) {
      if (!entry?.key) continue;
      const projectId = entry.key.slice(0, entry.key.lastIndexOf(':'));
      if (!projectIds.has(projectId)) {
        await idbStoreDelete('snapshots', entry.key).catch(() => { /* уже удалён */ });
        continue;
      }
      if (entry.project) snapshotProjects.push(entry.project);
    }
    const stale = unusedStorageKeys(await idbStoreKeys('pdfs'), [...live, ...saved, ...snapshotProjects]);
    for (const key of stale) await idbDelete(key).catch(() => { /* хранилище недоступно */ });
  } catch { /* хранилище недоступно — повторим при следующем изменении */ }
}
