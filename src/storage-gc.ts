import type { Project } from './model';

export interface ReferencedKeys {
  /** Ключи PDF в хранилище `pdfs` (без префикса `idb:`). */
  pdfs: Set<string>;
  /** Ключи фотографий (без префикса `photo:`). */
  photos: Set<string>;
}

/**
 * Собирает все блобы, на которые ссылаются состояния проекта: текущее, undo/redo,
 * сохранённые проекты и снимки версий. По этим ссылкам GC не трогает нужное.
 */
export function referencedStorageKeys(projects: Iterable<Project>): ReferencedKeys {
  const pdfs = new Set<string>();
  const photos = new Set<string>();
  for (const project of projects) {
    for (const floor of project.floors) {
      if (floor.pdfId?.startsWith('idb:')) {
        const key = floor.pdfId.slice(4);
        if (key) pdfs.add(key);
      }
    }
    for (const item of project.equipment) {
      for (const key of item.photos || []) if (key) photos.add(key);
    }
  }
  return { pdfs, photos };
}

/**
 * Возвращает ключи из хранилища `pdfs`, на которые больше нет ссылок.
 * PDF хранятся без префикса, фотографии — с префиксом `photo:`.
 */
export function unusedStorageKeys(allKeys: Iterable<string>, projects: Iterable<Project>): string[] {
  const referenced = referencedStorageKeys(projects);
  const unused: string[] = [];
  for (const key of allKeys) {
    if (!key) continue;
    if (key.startsWith('photo:')) {
      if (!referenced.photos.has(key.slice(6))) unused.push(key);
    } else if (!referenced.pdfs.has(key)) {
      unused.push(key);
    }
  }
  return unused;
}
