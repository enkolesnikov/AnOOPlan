import type { Project } from '../model';
import type { StructureTab } from './types';

/** Минимальная часть проекта, по которой считаются вкладки структуры. */
export type CountableProject = Pick<Project, 'floors' | 'equipment' | 'routes' | 'cables' | 'pins'>;

/**
 * Полные счётчики вкладок сайдбара: все объекты проекта, независимо от
 * выбранного этажа и активного поиска. Поиск фильтрует только список,
 * а подпись результата показывает «найдено из N».
 *
 * Это чистая функция: счётчики вкладок и строки журнала не могут разойтись
 * из-за того, что один из них считает отфильтрованный набор.
 */
export function structureCounts(project: CountableProject): Record<StructureTab, number> {
  return {
    floors: project.floors.length,
    equipment: project.equipment.length,
    routes: project.routes.length,
    cables: project.cables.length,
    pins: project.pins.length,
  };
}
