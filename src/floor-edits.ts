import type { Project } from './model';

/**
 * Удаляет этаж и всё, что на нём стоит: оборудование, замечания, сегменты,
 * кабели и опустевшие трассы. Меняет проект на месте — вызывать внутри mutate.
 *
 * Блобы фото здесь не трогаются: физическую очистку делает общий GC после
 * проверки ссылок в сохранённых проектах, undo/redo и снимках. Прямое удаление
 * ломало undo и общие ключи (F-02/D-01).
 */
export function removeFloor(project: Project, floorId: string): { equipmentIds: string[]; segmentIds: string[] } | null {
  if (!floorId || project.floors.length < 2 || !project.floors.some(floor => floor.id === floorId)) return null;
  const equipmentIds = project.equipment.filter(item => item.floorId === floorId).map(item => item.id);
  const segmentIds = project.routes.flatMap(route => route.segments)
    .filter(segment => segment.a.floorId === floorId || segment.b.floorId === floorId)
    .map(segment => segment.id);

  project.floors = project.floors.filter(floor => floor.id !== floorId);
  project.equipment = project.equipment.filter(item => item.floorId !== floorId);
  project.pins = project.pins.filter(pin => pin.floorId !== floorId);
  project.routes.forEach(route => {
    route.segments = route.segments.filter(segment => !segmentIds.includes(segment.id));
  });
  project.routes = project.routes.filter(route => route.segments.length > 0);
  project.cables = project.cables.filter(cable =>
    !equipmentIds.includes(cable.fromId)
    && !equipmentIds.includes(cable.toId)
    && !cable.segmentIds.some(id => segmentIds.includes(id)));
  // Размеры между оборудованием не могут ссылаться на удалённые объекты.
  project.dimensions = (project.dimensions ?? []).filter(dimension =>
    !equipmentIds.includes(dimension.fromId) && !equipmentIds.includes(dimension.toId));
  return { equipmentIds, segmentIds };
}
