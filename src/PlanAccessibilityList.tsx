import type { Floor, Project } from './model';

/**
 * Текстовая альтернатива canvas для скринридера: перечень объектов на плане.
 * Визуально скрыта, но доступна assistive-технологиям.
 */
export function PlanAccessibilityList({ project, floor }: { project: Project; floor: Floor }) {
  const equipment = project.equipment.filter(item => item.floorId === floor.id);
  const routes = project.routes.filter(route => route.segments.some(segment => segment.a.floorId === floor.id || segment.b.floorId === floor.id));
  const pins = (project.pins ?? []).filter(pin => pin.floorId === floor.id);
  return (
    <div className="sr-only">
      <h2>Объекты на плане: {floor.name}</h2>
      <p>Оборудование: {equipment.length}, трассы: {routes.length}, замечания: {pins.length}, кабелей в проекте: {project.cables.length}.</p>
      <ul>
        {equipment.map(item => (
          <li key={item.id}>{item.number}, {item.name}, {item.type}, X {item.x}, Y {item.y}{item.height === null ? ', высота не задана' : `, высота ${item.height} м`}</li>
        ))}
      </ul>
      <ul>
        {routes.map(route => <li key={route.id}>Трасса {route.number}, {route.type}, сегментов {route.segments.length}</li>)}
      </ul>
      <ul>
        {pins.map(pin => <li key={pin.id}>Замечание {pin.number}: {pin.comment || 'без текста'}, {pin.status === 'closed' ? 'закрыто' : 'открыто'}</li>)}
      </ul>
    </div>
  );
}
