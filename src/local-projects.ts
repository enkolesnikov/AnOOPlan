import type { Project } from './model';

export const PROJECTS_KEY = 'cableplan:projects';

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

export function saveLocalProject(project: Project, storage: ProjectStorage | null = defaultStorage()): void {
  if (!storage) return;
  const list = readLocalProjects(storage);
  const index = list.findIndex(item => item.id === project.id);
  if (index >= 0) list[index] = project;
  else list.push(project);
  storage.setItem(PROJECTS_KEY, JSON.stringify(list));
}

export function deleteLocalProject(id: string, storage: ProjectStorage | null = defaultStorage()): void {
  if (!storage) return;
  storage.setItem(PROJECTS_KEY, JSON.stringify(readLocalProjects(storage).filter(item => item.id !== id)));
}
