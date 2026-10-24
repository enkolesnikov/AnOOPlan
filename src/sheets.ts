// Состав таблиц выгрузки — общий модуль для сервера и офлайн-экспорта в приложении,
// чтобы XLSX/PDF/CSV содержали одни и те же данные и колонки.
import type { Cable, PriceKind, Project } from './model';
import { cableSection, calculateCable, routeSectionsText, specificationKnS, specifications, validateProject } from './engine';

/** Число в русской локали; null — прочерк (для текстовых ячеек выгрузки). */
const localizedNumber = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
import { estimate } from './estimate';

export type Cell = string | number | boolean | null;
export interface ExportSheet { name: string; rows: Cell[][] }

/** Диаметр кабеля для выгрузки: незаданное значение остаётся null, а не превращается в 0. */
function cableDiameter(cable: Cable): number | null {
  const value = cable.outerDiameterMm;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Русские названия видов позиций справочника цен. */
export const PRICE_KIND_LABELS: Record<PriceKind, string> = {
  equipment: 'Оборудование',
  cable: 'Кабель',
  tray: 'КНС',
};

/** Источник цены в смете: «вручную»/«справочник», неизвестный — null (пусто в таблице). */
export const priceSourceLabel = (source: 'manual' | 'catalog' | null): string | null =>
  source === 'manual' ? 'вручную' : source === 'catalog' ? 'справочник' : null;

/** Подпись строки работ: «Работы (25 %)»; без заданного процента — «Работы (не задан)», а не 0. */
export const laborLabel = (percent: number | null): string => (percent === null ? 'Работы (не задан)' : `Работы (${percent.toLocaleString('ru-RU')} %)`);

export function exportSheets(project: Project): ExportSheet[] {
  const specs = specifications(project);
  const specKnS = specificationKnS(project);
  const estimateResult = estimate(project);
  const journal: Cell[][] = [['Номер', 'Наименование', 'Марка', 'Диаметр, мм', 'Сечение, мм²', 'Назначение', 'От', 'До', 'Трасса (ID)', 'Количество', 'Геометрия, м', 'Запас трассы, м', 'Запас кабеля, м', 'Запас концов, м', 'Итог одного, м', 'Итог с количеством, м', 'Цена, ₽/м', 'Стоимость, ₽', 'Расчёт полный', 'Предупреждения', 'Примечание']];
  for (const cable of project.cables) {
    const result = calculateCable(project, cable);
    const section = cableSection(cable);
    const name = (id: string) => project.equipment.find(e => e.id === id)?.number || id;
    journal.push([cable.number, cable.name, cable.brand, cableDiameter(cable), section.areaMm2, cable.purpose, name(cable.fromId), name(cable.toId), cable.segmentIds.join(' → '), cable.quantity, result.geometry, result.routeReserve, result.cableReserve, result.endReserve, result.total, result.total === null ? null : result.total * cable.quantity, result.pricePerMeter, result.cost, result.complete, result.errors.join('; '), cable.note]);
  }

  // Смета: позиции материальных разделов и их итоги; работы — отдельной итоговой строкой,
  // чтобы не дублировать раздел «Работы» (у него нет позиций, только стоимость).
  const materialSections = estimateResult.sections.filter(section => section.kind !== 'work');
  const estimateRows: Cell[][] = [['Раздел', 'Позиция', 'Ед.', 'Количество', 'Цена, ₽', 'Сумма, ₽', 'Источник цены', 'Примечание']];
  for (const section of materialSections) {
    for (const line of section.lines) {
      estimateRows.push([section.title, line.name, line.unit, line.quantity, line.price, line.total, priceSourceLabel(line.priceSource), line.note]);
    }
    estimateRows.push(['', `Итого: ${section.title}`, '', '', '', section.total, '', '']);
  }
  estimateRows.push(['', 'Итого материалы', '', '', '', estimateResult.materials, '', '']);
  estimateRows.push(['', laborLabel(estimateResult.laborPercent), '', '', '', estimateResult.labor, '', '']);
  estimateRows.push(['', 'Итого по смете', '', '', '', estimateResult.total, '', '']);

  // Коммерческое предложение — короткая сводка по разделам для заказчика.
  const commercial: Cell[][] = [
    ['Проект', project.name],
    ['Дата прайса', estimateResult.catalogDate ?? '—'],
    ['Примечание', project.estimate?.note ?? ''],
    [],
    ['Раздел', 'Сумма, ₽'],
  ];
  for (const section of materialSections) commercial.push([section.title, section.total]);
  commercial.push(['Итого материалы', estimateResult.materials]);
  commercial.push([laborLabel(estimateResult.laborPercent), estimateResult.labor]);
  commercial.push(['Итого', estimateResult.total]);

  // Справочник цен проекта: позиции с ценами и примечаниями.
  const catalog: Cell[][] = [['Вид', 'Наименование', 'Ед.', 'Цена, ₽', 'Примечание']];
  for (const item of project.catalog ?? []) {
    catalog.push([PRICE_KIND_LABELS[item.kind] ?? item.kind, item.name, item.unit, item.price, item.note]);
  }

  return [
    { name: 'Кабельный журнал', rows: journal },
    { name: 'Оборудование', rows: [['Тип', 'Модель', 'Этаж', 'Количество'], ...specs.equipment.map(r => [r.type, r.model, r.floor, r.quantity])] },
    { name: 'Кабели', rows: [['Марка', 'Количество линий', 'Геометрия, м', 'Итого, м'], ...specs.cables.map(r => [r.brand, r.lines, r.geometry, r.total])] },
    { name: 'Схема трасс', rows: [['Трасса', 'Тип КНС', 'Сечения', 'Длина, м', 'Сегментов', 'Углы'], ...specs.routeSummary.routes.map(r => [r.number, r.type, routeSectionsText(r.sections, localizedNumber), r.length, r.segments, r.group === 'Кабель-канал' ? r.angles.total : null]), [], ['Итого по типам', '', '', '', '', ''], ...specs.routeSummary.groups.map(g => [g.group, '', '', g.length, g.routes, g.group === 'Кабель-канал' ? g.angles.total : null])] },
    { name: 'Спецификация КНС', rows: [['Наименование', 'Сечение', 'Подсистема', 'Ед.', 'Кол-во', 'Углы', 'Артикул', 'Производитель', 'Цена, ₽', 'Сумма, ₽'], ...specKnS.lines.map(line => [line.name, line.section, line.subsystem, line.unit, line.quantity, line.angles || null, line.article, line.manufacturer, line.price, line.cost]), [], ['Итого по типам', '', '', '', '', '', '', '', '', ''], ...specKnS.totals.map(item => [item.group, '', '', 'м', item.length, item.angles || null, '', '', '', ''])] },
    { name: 'Инфраструктура', rows: [['Тип', 'Длина, м', 'Сегментов', 'Кабелей', 'Макс. заполнение, %', 'Сегментов с превышением'], ...specs.infrastructure.map(r => [r.type, r.length, r.segments, r.cables, r.maxFillPercent, r.overSegments])] },
    { name: 'Заполнение КНС', rows: [['Трасса', 'Сегмент', 'Тип трассы', 'КНС, мм', 'Площадь КНС, мм²', 'Линий', 'Площадь кабелей, мм²', 'Заполнение, %', 'Статус'], ...specs.trayFill.map(r => [r.route, r.segment, r.routeType, r.tray, r.trayAreaMm2, r.lines, r.areaMm2, r.fillPercent, r.status])] },
    { name: 'Смета', rows: estimateRows },
    { name: 'Коммерческое предложение', rows: commercial },
    { name: 'Справочник цен', rows: catalog },
    { name: 'Замечания', rows: [['Номер', 'Этаж', 'X', 'Y', 'Замечание', 'Статус', 'Фото'], ...(project.pins ?? []).map(pin => [pin.number, project.floors.find(floor => floor.id === pin.floorId)?.name || '—', pin.x, pin.y, pin.comment, pin.status === 'closed' ? 'закрыто' : 'открыто', (pin.photos || []).length])] },
    // Оценка добавляет свои предупреждения (нет цен, нет процента работ); дубликаты убираем.
    { name: 'Предупреждения', rows: [['Предупреждение'], ...[...new Set([...validateProject(project), ...specs.errors, ...estimateResult.warnings])].map(e => [e])] },
  ];
}
