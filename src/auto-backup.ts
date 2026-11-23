/**
 * Счётчик сохранений для автоматической резервной копии `.anooplan` (3.0.0).
 *
 * Каждое N-е ручное сохранение проекта сопровождается выгрузкой файла
 * `.anooplan`: данные уезжают из браузерного хранилища в файл, который переживёт
 * очистку кэша и потерю устройства. Счётчик живёт в localStorage и привязан к id
 * проекта; при удалении проекта он сбрасывается.
 */

/** Каждое N-е сохранение сопровождается авто-экспортом. */
export const AUTO_BACKUP_EVERY = 10;

const KEY_PREFIX = 'cableplan:save-count:';

export interface CounterStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function defaultStorage(): CounterStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Текущее число сохранений проекта с момента последнего сброса. */
export function saveCounter(projectId: string, storage: CounterStorage | null = defaultStorage()): number {
  try {
    const raw = storage?.getItem(KEY_PREFIX + projectId);
    const value = raw === null || raw === undefined ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** Увеличивает счётчик и возвращает новое значение. */
export function bumpSaveCounter(projectId: string, storage: CounterStorage | null = defaultStorage()): number {
  const next = saveCounter(projectId, storage) + 1;
  try {
    storage?.setItem(KEY_PREFIX + projectId, String(next));
  } catch { /* переполнение не должно ломать сохранение */ }
  return next;
}

/** Сброс при удалении проекта или смене его идентичности (импорт как новый). */
export function resetSaveCounter(projectId: string, storage: CounterStorage | null = defaultStorage()): void {
  try {
    storage?.removeItem?.(KEY_PREFIX + projectId);
  } catch { /* хранилище недоступно */ }
}

/** true, если это сохранение — N-е и пора выгрузить резервную копию. */
export function isBackupDue(counter: number): boolean {
  return counter > 0 && counter % AUTO_BACKUP_EVERY === 0;
}
