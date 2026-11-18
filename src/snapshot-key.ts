// Ключ снимка: `<id проекта>:<timestamp>`. Идентификатор проекта может содержать
// двоеточие (импортированные файлы), поэтому границу разбираем по последнему `:`,
// а не по префиксу строки: иначе проект «a» видел бы снимки проекта «a:b».
export const snapshotKeyPrefix = (projectId: string): string => `${projectId}:`;

/** Идентификатор проекта из ключа снимка; '' — ключ не соответствует формату. */
export function snapshotProjectId(key: string): string {
  const index = key.lastIndexOf(':');
  return index > 0 ? key.slice(0, index) : '';
}

/** Время снимка из ключа; NaN — ключ не соответствует формату. */
export function snapshotTimestamp(key: string): number {
  const index = key.lastIndexOf(':');
  return index > 0 ? Number(key.slice(index + 1)) : NaN;
}

/** Ключи снимков одного проекта, новые сначала. */
export function projectSnapshotKeys(keys: Iterable<string>, projectId: string): string[] {
  return [...keys]
    .filter(key => snapshotProjectId(key) === projectId)
    .sort((a, b) => snapshotTimestamp(b) - snapshotTimestamp(a));
}
