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

/**
 * Черновик последнего открытого проекта. Нужен GC: в другой вкладке проект может
 * быть ещё не сохранён в список, но его блобы обязаны остаться живыми.
 */
export function readAutosaveDraft(storage: ProjectStorage | null = defaultStorage()): Project | null {
  try {
    const raw = storage?.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const draft: unknown = JSON.parse(raw);
    return draft && typeof draft === 'object' && !Array.isArray(draft) && typeof (draft as Project).id === 'string'
      ? draft as Project
      : null;
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
  storage.setItem(PROJECTS_KEY, JSON.stringify(readLocalProjects(storage).filter(item => item.id !== id)));
}
