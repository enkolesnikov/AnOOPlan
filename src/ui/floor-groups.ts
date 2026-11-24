import type { Building, Floor, Project } from '../model';

/** Группа этажей одного здания; building=null — этажи без привязки к зданию. */
export interface FloorGroup {
  building: Building | null;
  floors: Floor[];
  /** Полное число этажей группы в проекте (без фильтра поиска и порционной отрисовки). */
  total: number;
}

/**
 * Группировка этажей по зданиям для сайдбара и выпадающих списков. Проект без
 * зданий — одна плоская группа (building=null). Иначе порядок: здания в порядке
 * проекта, затем этажи без здания (включая висячие ссылки на удалённые здания).
 * Здания без этажей группу не образуют. `floors` позволяет передать уже
 * отфильтрованный/урезанный список — total всё равно считается по проекту.
 */
export function groupFloorsByBuilding(project: Project, floors: Floor[] = project.floors): FloorGroup[] {
  const buildings = project.buildings ?? [];
  if (!buildings.length) {
    return floors.length ? [{ building: null, floors, total: project.floors.length }] : [];
  }
  const known = new Set(buildings.map(building => building.id));
  const groups: FloorGroup[] = [];
  for (const building of buildings) {
    const items = floors.filter(floor => floor.buildingId === building.id);
    if (!items.length) continue;
    groups.push({ building, floors: items, total: project.floors.filter(floor => floor.buildingId === building.id).length });
  }
  const rest = floors.filter(floor => !floor.buildingId || !known.has(floor.buildingId));
  if (rest.length) groups.push({ building: null, floors: rest, total: rest.length });
  return groups;
}
