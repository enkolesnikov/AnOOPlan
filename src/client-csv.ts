import type { Project } from './model';
import { calculateCable, specifications } from './engine';

/** CSV с BOM и точкой с запятой: открывается в Excel без импорта. */
export function clientCsv(project: Project): string {
  const specs = specifications(project);
  const rows: (string | number | null)[][] = [];
  rows.push(['Кабельный журнал']);
  rows.push(['Номер', 'Наименование', 'Марка', 'От', 'До', 'Количество', 'Итог одного, м', 'Итог всего, м', 'Полный']);
  for (const cable of project.cables) {
    const result = calculateCable(project, cable);
    const name = (id: string) => project.equipment.find(item => item.id === id)?.number || id;
    rows.push([cable.number, cable.name, cable.brand, name(cable.fromId), name(cable.toId), cable.quantity, result.total, result.total === null ? null : result.total * cable.quantity, result.complete ? 'Да' : 'Нет']);
  }
  rows.push([]); rows.push(['Оборудование']); rows.push(['Тип', 'Модель', 'Этаж', 'Количество']);
  for (const group of specs.equipment) rows.push([group.type, group.model, group.floor, group.quantity]);
  rows.push([]); rows.push(['Кабели (сводно)']); rows.push(['Марка', 'Линий', 'Геометрия, м', 'Итого, м']);
  for (const group of specs.cables) rows.push([group.brand, group.lines, group.geometry, group.total]);
  rows.push([]); rows.push(['Инфраструктура']); rows.push(['Тип', 'Длина, м', 'Сегментов', 'Кабелей']);
  for (const group of specs.infrastructure) rows.push([group.type, group.length, group.segments, group.cables]);
  const cell = (value: string | number | null) => {
    let text = value === null ? '' : String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.split('"').join('""')}"`;
  };
  return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n');
}
