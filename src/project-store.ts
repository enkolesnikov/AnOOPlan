import type { Project } from './model';
import { logDiagnostic } from './diagnostics';
import { idbStoreDelete, idbStoreGet, idbStoreGetAll, idbStorePut } from './idb';
import {
  CORRUPT_PROJECTS_KEY,
  PROJECTS_KEY,
  deleteLocalProject,
  readLocalProjects,
  saveLocalProject,
  type ProjectStorage,
} from './local-projects';

/**
 * Хранилище сохранённых проектов в IndexedDB (3.0.0).
 *
 * До 3.0.0 весь список проектов жил одной JSON-записью в localStorage
 * (`cableplan:projects`): квота ~5 МБ делилась на всё приложение, запись была
 * «всё или ничего», а переполнение затирало список целиком. Теперь каждый проект —
 * отдельная запись в хранилище `projects` (ключ = `project.id`), квота IndexedDB
 * на порядки больше, а при `navigator.storage.persist()` браузер не вычищает её
 * под давлением места.
 *
 * Старый localStorage-список переносится одноразовой миграцией
 * (`migrateProjectsToIdb`): записи копируются в IndexedDB, оригинал сохраняется
 * под `MIGRATED_PROJECTS_KEY` как страховка и ключ очищается, чтобы GC не видел
 * проекты дважды.
 *
 * Если IndexedDB недоступен (приватный режим, урезанный WebView), операции
 * прозрачно работают через прежний localStorage-путь: чтение объединяет оба
 * источника, запись деградирует в localStorage. Данные не теряются ни в одной
 * среде, а после появления IndexedDB миграция доберёт остаток на старте.
 */

/** Хранилище IndexedDB со списком проектов. */
export const PROJECT_STORE = 'projects';
/** Ключ localStorage, куда миграция складывает исходный JSON списка (страховка). */
export const MIGRATED_PROJECTS_KEY = 'cableplan:projects.migrated';

function defaultStorage(): ProjectStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Список сохранённых проектов: IndexedDB плюс остаток legacy-списка.
 * Дубли по id выигрывает запись из IndexedDB (туда пишет текущая версия).
 */
export async function listStoredProjects(storage: ProjectStorage | null = defaultStorage()): Promise<Project[]> {
  const byId = new Map<string, Project>();
  for (const legacy of readLocalProjects(storage)) {
    if (legacy && typeof legacy.id === 'string') byId.set(legacy.id, legacy);
  }
  try {
    const stored = await idbStoreGetAll<Project>(PROJECT_STORE);
    for (const project of stored) {
      if (project && typeof project === 'object' && typeof project.id === 'string') byId.set(project.id, project);
    }
  } catch (error) {
    logDiagnostic('error', error, 'project-store-list');
  }
  return [...byId.values()];
}

export async function readStoredProject(id: string, storage: ProjectStorage | null = defaultStorage()): Promise<Project | undefined> {
  try {
    const stored = await idbStoreGet<Project>(PROJECT_STORE, id);
    if (stored) return stored;
  } catch (error) {
    logDiagnostic('error', error, 'project-store-read');
  }
  return readLocalProjects(storage).find(project => project.id === id);
}

/** Сохраняет проект в IndexedDB; при недоступности — в прежний localStorage-список. */
export async function saveStoredProject(project: Project, storage: ProjectStorage | null = defaultStorage()): Promise<void> {
  try {
    await idbStorePut(PROJECT_STORE, project.id, project);
    return;
  } catch (error) {
    logDiagnostic('error', error, 'project-store-save');
  }
  saveLocalProject(project, storage);
}

/** Удаляет проект из обоих хранилищ: legacy-копия не должна воскреснуть в списке. */
export async function deleteStoredProject(id: string, storage: ProjectStorage | null = defaultStorage()): Promise<void> {
  try {
    await idbStoreDelete(PROJECT_STORE, id);
  } catch (error) {
    logDiagnostic('error', error, 'project-store-delete');
  }
  try {
    deleteLocalProject(id, storage);
  } catch (error) {
    // Повреждённый legacy-список не должен блокировать удаление из IndexedDB.
    logDiagnostic('error', error, 'project-store-delete-legacy');
  }
}

/**
 * Одноразовый перенос списка проектов из localStorage в IndexedDB.
 * Возвращает число перенесённых проектов (0 — мигрировать нечего).
 *
 * Безопасность: исходная запись не удаляется, пока все валидные проекты не
 * записаны в IndexedDB; после успеха оригинал копируется в MIGRATED_PROJECTS_KEY.
 * Повреждённый список не переносится и не затирается: он остаётся на месте,
 * а его копия кладётся в CORRUPT_PROJECTS_KEY (как и при записи в 2.x).
 */
export async function migrateProjectsToIdb(storage: ProjectStorage | null = defaultStorage()): Promise<number> {
  if (!storage) return 0;
  const raw = storage.getItem(PROJECTS_KEY);
  if (!raw) return 0;
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    try { storage.setItem(CORRUPT_PROJECTS_KEY, raw); } catch { /* копия не поместилась */ }
    return 0;
  }
  if (!Array.isArray(list)) {
    try { storage.setItem(CORRUPT_PROJECTS_KEY, raw); } catch { /* копия не поместилась */ }
    return 0;
  }
  const projects = (list as Project[]).filter(item => item && typeof item === 'object' && typeof item.id === 'string');
  try {
    for (const project of projects) {
      await idbStorePut(PROJECT_STORE, project.id, project);
    }
  } catch (error) {
    // IndexedDB недоступен: список остаётся в localStorage до следующего запуска.
    logDiagnostic('error', error, 'projects-migration');
    return 0;
  }
  try {
    storage.setItem(MIGRATED_PROJECTS_KEY, raw);
    storage.removeItem?.(PROJECTS_KEY);
  } catch { /* страховка не поместилась — проекты уже в IndexedDB, миграция состоялась */ }
  return projects.length;
}

/** Признак, что localStorage-список ещё не перенесён (запуск после обновления). */
export function hasLegacyProjectList(storage: ProjectStorage | null = defaultStorage()): boolean {
  try {
    return Boolean(storage?.getItem(PROJECTS_KEY));
  } catch {
    return false;
  }
}
