import type { Project } from './model';

/**
 * Ключи фотообъектов `photo:*`, которые станут сиротами после удаления оборудования.
 *
 * Один и тот же ключ теоретически может использоваться несколькими единицами
 * оборудования (например, после ручного редактирования JSON), поэтому удаляем
 * только те ключи, на которые больше никто не ссылается.
 */
export function orphanPhotoKeys(project: Project, equipmentIds: Iterable<string>): string[] {
  const removed = new Set(equipmentIds);
  const kept = new Set<string>();
  const candidates = new Set<string>();

  for (const item of [...project.equipment, ...(project.pins ?? [])]) {
    const keys = item.photos || [];
    for (const key of keys) {
      if (!key) continue;
      if (removed.has(item.id)) candidates.add(key);
      else kept.add(key);
    }
  }

  return [...candidates].filter(key => !kept.has(key));
}

/**
 * Удаляет блобы фото из хранилища. Ошибки отдельных ключей не прерывают очистку:
 * недоступная IndexedDB не должна ломать удаление объекта из проекта.
 */
export async function purgePhotoBlobs(keys: Iterable<string>, remove: (key: string) => Promise<void>): Promise<number> {
  let removed = 0;
  for (const key of keys) {
    try {
      await remove('photo:' + key);
      removed += 1;
    } catch { /* ключ уже удалён или хранилище недоступно */ }
  }
  return removed;
}
