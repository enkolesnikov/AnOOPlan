// Состав таблиц выгрузки — общий модуль для сервера и офлайн-экспорта в приложении,
// чтобы XLSX/PDF/CSV содержали одни и те же данные и колонки.
import type { Project } from './model';
import { calculateCable, specifications, validateProject } from './engine';

export type Cell = string | number | boolean | null;
export interface ExportSheet { name: string; rows: Cell[][] }

export function exportSheets(project: Project): ExportSheet[] {
  const specs = specifications(project);
  const journal: Cell[][] = [['Номер', 'Наименование', 'Марка', 'Назначение', 'От', 'До', 'Трасса (ID)', 'Количество', 'Геометрия, м', 'Запас трассы, м', 'Запас кабеля, м', 'Запас концов, м', 'Итог одного, м', 'Итог с количеством, м', 'Цена, ₽/м', 'Стоимость, ₽', 'Расчёт полный', 'Предупреждения', 'Примечание']];
  for (const cable of project.cables) {
    const result = calculateCable(project, cable);
    const name = (id: string) => project.equipment.find(e => e.id === id)?.number || id;
    journal.push([cable.number, cable.name, cable.brand, cable.purpose, name(cable.fromId), name(cable.toId), cable.segmentIds.join(' → '), cable.quantity, result.geometry, result.routeReserve, result.cableReserve, result.endReserve, result.total, result.total === null ? null : result.total * cable.quantity, result.pricePerMeter, result.cost, result.complete, result.errors.join('; '), cable.note]);
  }
  return [
    { name: 'Кабельный журнал', rows: journal },
    { name: 'Оборудование', rows: [['Тип', 'Модель', 'Этаж', 'Количество'], ...specs.equipment.map(r => [r.type, r.model, r.floor, r.quantity])] },
    { name: 'Кабели', rows: [['Марка', 'Количество линий', 'Геометрия, м', 'Итого, м'], ...specs.cables.map(r => [r.brand, r.lines, r.geometry, r.total])] },
    { name: 'Инфраструктура', rows: [['Тип', 'Длина, м', 'Сегментов', 'Кабелей'], ...specs.infrastructure.map(r => [r.type, r.length, r.segments, r.cables])] },
    { name: 'Замечания', rows: [['Номер', 'Этаж', 'X', 'Y', 'Замечание', 'Статус', 'Фото'], ...(project.pins ?? []).map(pin => [pin.number, project.floors.find(floor => floor.id === pin.floorId)?.name || '—', pin.x, pin.y, pin.comment, pin.status === 'closed' ? 'закрыто' : 'открыто', (pin.photos || []).length])] },
    { name: 'Предупреждения', rows: [['Предупреждение'], ...[...new Set([...validateProject(project), ...specs.errors])].map(e => [e])] },
  ];
}
