import type { Project } from './model';

export const PROJECTS_KEY = 'cableplan:projects';
export const AUTOSAVE_KEY = 'cableplan:autosave';

export interface ProjectStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): ProjectStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Список сохранённых проектов; повреждённое хранилище не должно ломать запуск. */
export function readLocalProjects(storage: ProjectStorage | null = defaultStorage()): Project[] {
  try {
    const raw = storage?.getItem(PROJECTS_KEY);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list as Project[] : [];
  } catch {
    return [];
  }
}

/** Разбор списка; null — значение повреждено (не массив/не JSON). */
function parseProjects(raw: string | null): Project[] | null {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as Project[] : null;
  } catch {
    return null;
  }
}
/**
 * Черновик последнего открытого проекта. Нужен GC: в другой вкладке проект может
 * быть ещё не сохранён в список, но его блобы обязаны остаться живыми.
 */
export function readAutosaveDraft(storage: ProjectStorage | null = defaultStorage()): Project | null {
  try {
    const raw = storage?.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<Project> | null;
    // GC пойдёт по floors/equipment: неполный объект там уронил бы всю уборку.
    const valid = draft && typeof draft === 'object' && !Array.isArray(draft)
      && typeof draft.id === 'string'
      && Array.isArray(draft.floors) && Array.isArray(draft.equipment)
      && Array.isArray(draft.routes) && Array.isArray(draft.cables);
    return valid ? draft as Project : null;
  } catch {
    return null;
  }
}

/** Резервная копия повреждённого списка — чтобы данные не исчезли без следа. */
export const CORRUPT_PROJECTS_KEY = 'cableplan:projects.corrupt';

export function saveLocalProject(project: Project, storage: ProjectStorage | null = defaultStorage()): void {
  if (!storage) throw new Error('Хранилище браузера недоступно: проект не сохранён.');
  let list: Project[] = [];
  const raw = storage.getItem(PROJECTS_KEY);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      list = parsed as Project[];
    } catch {
      // Не затираем повреждённый список: сначала сохраняем его копию, затем
      // останавливаем запись — пользователь должен увидеть ошибку и выгрузить проект.
      try { storage.setItem(CORRUPT_PROJECTS_KEY, raw); } catch { /* копия не поместилась */ }
      throw new Error('Список проектов в браузере повреждён. Он не перезаписан; сохраните текущий проект в .anooplan и очистите хранилище.');
    }
  }
  const index = list.findIndex(item => item.id === project.id);
  if (index >= 0) list[index] = project;
  else list.push(project);
  storage.setItem(PROJECTS_KEY, JSON.stringify(list));
}

export function deleteLocalProject(id: string, storage: ProjectStorage | null = defaultStorage()): void {
  if (!storage) return;
  const list = parseProjects(storage.getItem(PROJECTS_KEY));
  if (list === null) {
    // Не превращаем повреждённый список в [] — это уничтожило бы все проекты.
    throw new Error('Список проектов повреждён: удаление не выполнено, данные сохранены как есть.');
  }
  storage.setItem(PROJECTS_KEY, JSON.stringify(list.filter(item => item.id !== id)));
}
