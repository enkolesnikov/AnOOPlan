import type { Project } from '../model';
import { groupFloorsByBuilding } from './floor-groups';

/** Выпадающий список этажей проекта; при наличии зданий этажи группируются по ним. */
export function floorSelect(project: Project, value: string, change: (id: string) => void) {
  const option = (floor: Project['floors'][number]) => <option key={floor.id} value={floor.id}>{floor.name}</option>;
  if (!(project.buildings ?? []).length) {
    return <select value={value} onChange={e => change(e.target.value)}>{project.floors.map(option)}</select>;
  }
  return <select value={value} onChange={e => change(e.target.value)}>
    {groupFloorsByBuilding(project).map(group => group.building
      ? <optgroup key={group.building.id} label={group.building.name}>{group.floors.map(option)}</optgroup>
      : group.floors.map(option))}
  </select>;
}

/** Выпадающий список оборудования проекта. */
export function equipmentSelect(project: Project, value: string, change: (id: string) => void) {
  return <select value={value} onChange={e => change(e.target.value)}><option value="">Выберите оборудование</option>{project.equipment.map(eq => <option key={eq.id} value={eq.id}>{eq.number} · {eq.name}</option>)}</select>;
}
