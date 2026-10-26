/**
 * Мультивыбор в списках структуры: переключение, «выбрать всё», порционная
 * отрисовка и расчёт связанных кабелей для массового удаления.
 */
import type { Project } from '../model';
import type { ObjectKind, StructureTab } from './types';

/** Вкладки, где поддерживается мультивыбор (этажи удаляются только по одному). */
export function isBulkTab(tab: StructureTab): tab is Exclude<StructureTab, 'floors'> {
  return tab !== 'floors';
}

/** Какой ObjectKind соответствует вкладке (null для этажей). */
export function bulkKind(tab: StructureTab): ObjectKind | null {
  if (tab === 'equipment') return 'equipment';
  if (tab === 'routes') return 'route';
  if (tab === 'cables') return 'cable';
  if (tab === 'pins') return 'pin';
  return null;
}

/** Добавляет/убирает id, сохраняя порядок выделения. */
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id];
}

/** Все id списка — для кнопки «Все». */
export function allIds(items: ReadonlyArray<{ id: string }>): string[] {
  return items.map(item => item.id);
}

/** Первые limit элементов; limit <= 0 даёт пустой список. */
export function pageSlice<T>(items: readonly T[], limit: number): T[] {
  return items.slice(0, Math.max(0, Math.trunc(limit)));
}

/**
 * Кабели, которые будут удалены вместе с объектами: оборудование — по концам,
 * трасса — по любым её сегментам, кабель — сам.
 */
export function affectedCableIds(project: Project, kind: ObjectKind, ids: string[]): string[] {
  const selected = new Set(ids);
  const segmentIds = kind === 'route'
    ? new Set(project.routes.filter(route => selected.has(route.id)).flatMap(route => route.segments.map(segment => segment.id)))
    : new Set<string>();
  return project.cables
    .filter(cable => {
      if (kind === 'equipment') return selected.has(cable.fromId) || selected.has(cable.toId);
      if (kind === 'route') return cable.segmentIds.some(segmentId => segmentIds.has(segmentId));
      if (kind === 'cable') return selected.has(cable.id);
      return false;
    })
    .map(cable => cable.id);
}
