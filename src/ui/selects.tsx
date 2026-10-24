import type { Project } from '../model';

/** Выпадающий список этажей проекта. */
export function floorSelect(project: Project, value: string, change: (id: string) => void) {
  return <select value={value} onChange={e => change(e.target.value)}>{project.floors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>;
}

/** Выпадающий список оборудования проекта. */
export function equipmentSelect(project: Project, value: string, change: (id: string) => void) {
  return <select value={value} onChange={e => change(e.target.value)}><option value="">Выберите оборудование</option>{project.equipment.map(eq => <option key={eq.id} value={eq.id}>{eq.number} · {eq.name}</option>)}</select>;
}
