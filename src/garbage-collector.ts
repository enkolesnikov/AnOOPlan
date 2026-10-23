import type { Project } from './model';
import type { SnapshotEntry } from './use-snapshots';
import { idbDelete, idbStoreDelete, idbStoreGetAll, idbStoreKeys } from './idb';
import { readLocalProjects } from './local-projects';
import { unusedStorageKeys } from './storage-gc';

/**
 * Убирает блобы, на которые больше не ссылается ни проект, ни undo/redo,
 * ни сохранённые проекты, ни снимки версий. Снимки удалённых проектов
 * тоже вычищаются: иначе они держат PDF и фото вечно.
 */
export async function collectStorageGarbage(states: Project[]): Promise<void> {
  try {
    const saved = readLocalProjects();
    const projectIds = new Set([...states, ...saved].map(item => item.id));
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
    const stale = unusedStorageKeys(await idbStoreKeys('pdfs'), [...states, ...saved, ...snapshotProjects]);
    for (const key of stale) await idbDelete(key).catch(() => { /* хранилище недоступно */ });
  } catch { /* хранилище недоступно — повторим при следующем изменении */ }
}
