import type { Cable, Project } from './model';
import { cableSection, calculateCable, specifications } from './engine';
import { estimate } from './estimate';
import { PRICE_KIND_LABELS, laborLabel, priceSourceLabel } from './sheets';

/** Диаметр кабеля для выгрузки: незаданное значение остаётся пустым, а не превращается в 0. */
function cableDiameter(cable: Cable): number | null {
  const value = cable.outerDiameterMm;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** CSV с BOM и точкой с запятой: открывается в Excel без импорта. */
export function clientCsv(project: Project): string {
  const specs = specifications(project);
  const estimateResult = estimate(project);
  const rows: (string | number | null)[][] = [];
  rows.push(['Кабельный журнал']);
  rows.push(['Номер', 'Наименование', 'Марка', 'Диаметр, мм', 'Сечение, мм²', 'От', 'До', 'Количество', 'Итог одного, м', 'Итог всего, м', 'Полный']);
  for (const cable of project.cables) {
    const result = calculateCable(project, cable);
    const name = (id: string) => project.equipment.find(item => item.id === id)?.number || id;
    rows.push([cable.number, cable.name, cable.brand, cableDiameter(cable), cableSection(cable).areaMm2, name(cable.fromId), name(cable.toId), cable.quantity, result.total, result.total === null ? null : result.total * cable.quantity, result.complete ? 'Да' : 'Нет']);
  }
  rows.push([]); rows.push(['Оборудование']); rows.push(['Тип', 'Модель', 'Этаж', 'Количество']);
  for (const group of specs.equipment) rows.push([group.type, group.model, group.floor, group.quantity]);
  rows.push([]); rows.push(['Кабели (сводно)']); rows.push(['Марка', 'Линий', 'Геометрия, м', 'Итого, м']);
  for (const group of specs.cables) rows.push([group.brand, group.lines, group.geometry, group.total]);
  rows.push([]); rows.push(['Замечания']); rows.push(['Номер', 'Этаж', 'X', 'Y', 'Замечание', 'Статус']);
  for (const pin of project.pins ?? []) rows.push([pin.number, project.floors.find(floor => floor.id === pin.floorId)?.name || '', pin.x, pin.y, pin.comment, pin.status === 'closed' ? 'закрыто' : 'открыто']);
  rows.push([]); rows.push(['Инфраструктура']); rows.push(['Тип', 'Длина, м', 'Сегментов', 'Кабелей', 'Макс. заполнение, %', 'Сегментов с превышением']);
  for (const group of specs.infrastructure) rows.push([group.type, group.length, group.segments, group.cables, group.maxFillPercent, group.overSegments]);
  rows.push([]); rows.push(['Заполнение КНС']); rows.push(['Трасса', 'Сегмент', 'КНС, мм', 'Линий', 'Площадь кабелей, мм²', 'Заполнение, %', 'Статус']);
  for (const row of specs.trayFill) rows.push([row.route, row.segment, row.tray, row.lines, row.areaMm2, row.fillPercent, row.status]);

  // Смета: позиции материальных разделов и их итоги; работы — отдельной итоговой строкой.
  const materialSections = estimateResult.sections.filter(section => section.kind !== 'work');
  const worksLabel = laborLabel(estimateResult.laborPercent);
  rows.push([]); rows.push(['Смета']);
  rows.push(['Раздел', 'Позиция', 'Ед.', 'Количество', 'Цена, ₽', 'Сумма, ₽', 'Источник цены', 'Примечание']);
  for (const section of materialSections) {
    for (const line of section.lines) rows.push([section.title, line.name, line.unit, line.quantity, line.price, line.total, priceSourceLabel(line.priceSource), line.note]);
    rows.push(['', `Итого: ${section.title}`, '', '', '', section.total, '', '']);
  }
  rows.push(['', 'Итого материалы', '', '', '', estimateResult.materials, '', '']);
  rows.push(['', worksLabel, '', '', '', estimateResult.labor, '', '']);
  rows.push(['', 'Итого по смете', '', '', '', estimateResult.total, '', '']);

  // Коммерческое предложение — сводка по разделам для заказчика.
  rows.push([]); rows.push(['Коммерческое предложение']);
  rows.push(['Проект', project.name]);
  rows.push(['Дата прайса', estimateResult.catalogDate ?? '—']);
  rows.push(['Примечание', project.estimate?.note ?? '']);
  rows.push([]); rows.push(['Раздел', 'Сумма, ₽']);
  for (const section of materialSections) rows.push([section.title, section.total]);
  rows.push(['Итого материалы', estimateResult.materials]);
  rows.push([worksLabel, estimateResult.labor]);
  rows.push(['Итого', estimateResult.total]);

  // Справочник цен проекта.
  rows.push([]); rows.push(['Справочник цен']);
  rows.push(['Вид', 'Наименование', 'Ед.', 'Цена, ₽', 'Примечание']);
  for (const item of project.catalog ?? []) rows.push([PRICE_KIND_LABELS[item.kind] ?? item.kind, item.name, item.unit, item.price, item.note]);

  const cell = (value: string | number | null) => {
    let text = value === null ? '' : String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.split('"').join('""')}"`;
  };
  return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n');
}
