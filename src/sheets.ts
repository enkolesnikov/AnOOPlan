// Состав таблиц выгрузки — общий модуль для сервера и офлайн-экспорта в приложении,
// чтобы XLSX/PDF/CSV содержали одни и те же данные и колонки.
import type { Cable, PriceKind, Project } from './model';
import { cableSection, calculateCable, domainWarnings, routeSectionsText, specificationKnS, specifications, validateProject } from './engine';
import type { EstimateResult } from './estimate';

/** Число в русской локали; null — прочерк (для текстовых ячеек выгрузки). */
const localizedNumber = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
import { estimate } from './estimate';

export type Cell = string | number | boolean | null;
export interface ExportSheet {
  name: string;
  rows: Cell[][];
  /**
   * Границы непрерывной таблицы для автофильтра: fromRow — строка шапки,
   * toRow — последняя строка данных (0-based, включительно).
   * Поля нет — лист без автофильтра: итоги стоят вперемешку с данными
   * («Смета», «Спецификация КНС»), и фильтр перемешал бы их.
   */
  table?: { fromRow: number; toRow: number };
}

/** Конечное число для ячейки; NaN/Infinity/undefined — null (пусто), а не «NaN». */
const finiteCell = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

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

/**
 * Подпись строки работ: «Работы (25 %)» в режиме процента, «Работы (по видам)» в режиме
 * работ по видам; без заданного процента — «Работы (не задан)», а не 0.
 */
export const laborLabel = (percent: number | null, mode: 'percent' | 'items' = 'percent'): string =>
  mode === 'items'
    ? 'Работы (по видам)'
    : percent === null ? 'Работы (не задан)' : `Работы (${percent.toLocaleString('ru-RU')} %)`;

/** НДС начисляется: нулевая или отсутствующая ставка — нет. */
export const vatCharged = (result: EstimateResult): boolean => result.vatRate !== null && result.vatRate > 0;

/** Строка НДС: «НДС 20 %» или «НДС 20 % (в т.ч.)», если налог уже включён в цены. */
export const vatLabel = (result: EstimateResult): string =>
  `НДС ${result.vatRate!.toLocaleString('ru-RU')} %${result.vatIncluded ? ' (в т.ч.)' : ''}`;

/** Примечание о налоге в ценах: «Цены с НДС» / «Цены без НДС». */
export const pricesVatLabel = (result: EstimateResult): string => (result.vatIncluded ? 'Цены с НДС' : 'Цены без НДС');

export function exportSheets(project: Project): ExportSheet[] {
  const specs = specifications(project);
  const specKnS = specificationKnS(project);
  const estimateResult = estimate(project);
  const journal: Cell[][] = [['Номер', 'Наименование', 'Марка', 'Диаметр, мм', 'Сечение, мм²', 'Назначение', 'От', 'До', 'Трасса (ID)', 'Количество', 'Геометрия, м', 'Запас трассы, м', 'Запас кабеля, м', 'Запас концов, м', 'Итог одного, м', 'Итог с количеством, м', 'Цена, ₽/м', 'Стоимость, ₽', 'Расчёт полный', 'Предупреждения', 'Примечание']];
  for (const cable of project.cables) {
    const result = calculateCable(project, cable);
    const section = cableSection(cable);
    const name = (id: string) => project.equipment.find(e => e.id === id)?.number || id;
    journal.push([cable.number, cable.name, cable.brand, cableDiameter(cable), section.areaMm2, cable.purpose, name(cable.fromId), name(cable.toId), cable.segmentIds.join(' → '), finiteCell(cable.quantity), result.geometry, result.routeReserve, result.cableReserve, result.endReserve, result.total, result.total === null || finiteCell(cable.quantity) === null ? null : result.total * cable.quantity, result.pricePerMeter, result.cost, result.complete, result.errors.join('; '), cable.note]);
  }

  // Смета: позиции материальных разделов и их итоги; в режиме работ по видам строки работ
  // выводятся обычными позициями раздела «Работы» (с «Итого: Работы»), в режиме процента —
  // одной итоговой строкой, чтобы не дублировать раздел без позиций. Далее — итоги до НДС,
  // НДС и итог с НДС; при заданном округлении в конце примечание о его шаге.
  const worksSection = estimateResult.sections.find(section => section.kind === 'work');
  const materialSections = estimateResult.sections.filter(section => section.kind !== 'work');
  const estimateRows: Cell[][] = [['Раздел', 'Позиция', 'Ед.', 'Количество', 'Цена, ₽', 'Сумма, ₽', 'Источник цены', 'Примечание']];
  for (const section of materialSections) {
    for (const line of section.lines) {
      estimateRows.push([section.title, line.name, line.unit, line.quantity, line.price, line.total, priceSourceLabel(line.priceSource), line.note]);
    }
    estimateRows.push(['', `Итого: ${section.title}`, '', '', '', section.total, '', '']);
  }
  if (estimateResult.worksMode === 'items') {
    for (const line of worksSection?.lines ?? []) {
      estimateRows.push([worksSection?.title ?? 'Работы', line.name, line.unit, line.quantity, line.price, line.total, priceSourceLabel(line.priceSource), line.note]);
    }
    estimateRows.push(['', `Итого: ${worksSection?.title ?? 'Работы'}`, '', '', '', estimateResult.labor, '', '']);
  }
  estimateRows.push(['', 'Итого материалы', '', '', '', estimateResult.materials, '', '']);
  estimateRows.push(['', laborLabel(estimateResult.laborPercent, estimateResult.worksMode), '', '', '', estimateResult.labor, '', '']);
  estimateRows.push(['', vatCharged(estimateResult) ? 'Итого до НДС' : 'Итого по смете', '', '', '', estimateResult.total, '', '']);
  if (vatCharged(estimateResult)) {
    estimateRows.push(['', vatLabel(estimateResult), '', '', '', estimateResult.vat, '', '']);
    estimateRows.push(['', 'Итого с НДС', '', '', '', estimateResult.gross, '', '']);
  }
  if (estimateResult.rounding !== null) {
    estimateRows.push(['', `Округление: до ${estimateResult.rounding.toLocaleString('ru-RU')} ₽`, '', '', '', '', '', '']);
  }

  // Коммерческое предложение — короткая сводка по разделам для заказчика с теми же
  // итогами и примечанием, включён ли НДС в цены. Шапка таблицы стоит ниже
  // реквизитов, поэтому автофильтр начинается с неё, а не с первой строки листа.
  const commercial: Cell[][] = [
    ['Проект', project.name],
    ['Дата прайса', estimateResult.catalogDate ?? '—'],
    ['Примечание', project.estimate?.note ?? ''],
    [],
  ];
  const commercialFromRow = commercial.length;
  commercial.push(['Раздел', 'Сумма, ₽']);
  for (const section of materialSections) commercial.push([section.title, section.total]);
  commercial.push(['Итого материалы', estimateResult.materials]);
  commercial.push([laborLabel(estimateResult.laborPercent, estimateResult.worksMode), estimateResult.labor]);
  commercial.push([vatCharged(estimateResult) ? 'Итого до НДС' : 'Итого', estimateResult.total]);
  if (vatCharged(estimateResult)) {
    commercial.push([vatLabel(estimateResult), estimateResult.vat]);
    commercial.push(['Итого с НДС', estimateResult.gross]);
  }
  // Хвост «Цены с НДС» отделён пустой строкой: фильтр его не накрывает.
  const commercialToRow = commercial.length - 1;
  commercial.push([]);
  commercial.push([pricesVatLabel(estimateResult)]);

  // Спецификация КНС: строки идут блоками по подсистемам (порядок задаёт specificationKnS),
  // после каждого блока — подытог; тип, сечение и стоимость остаются в своих колонках шапки.
  const knsRows: Cell[][] = [['Наименование', 'Сечение', 'Подсистема', 'Ед.', 'Кол-во', 'Углы', 'Артикул', 'Производитель', 'Цена, ₽', 'Сумма, ₽']];
  for (const subsystem of specKnS.subsystems) {
    for (const line of specKnS.lines.filter(item => item.subsystem === subsystem.subsystem)) {
      knsRows.push([line.name, line.section, line.subsystem, line.unit, line.quantity, line.angles || null, line.article, line.manufacturer, line.price, line.cost]);
    }
    knsRows.push([`Итого по подсистеме: ${subsystem.subsystem}`, '', '', 'м', subsystem.length, subsystem.angles || null, '', '', '', subsystem.cost]);
  }
  knsRows.push([]);
  knsRows.push(['Итого по типам', '', '', '', '', '', '', '', '', '']);
  for (const total of specKnS.totals) {
    knsRows.push([total.group, '', '', 'м', total.length, total.angles || null, '', '', '', total.cost]);
  }
  knsRows.push(['Всего КНС', '', '', 'м', specKnS.totalLength, null, '', '', '', specKnS.totalCost]);

  // Непрерывная таблица: шапка в первой строке, данные до последней строки листа.
  const wholeTable = (rows: Cell[][]): { fromRow: number; toRow: number } => ({ fromRow: 0, toRow: rows.length - 1 });

  const equipmentRows: Cell[][] = [['Тип', 'Модель', 'Этаж', 'Количество'], ...specs.equipment.map(r => [r.type, r.model, r.floor, r.quantity])];
  const cableRows: Cell[][] = [['Марка', 'Количество линий', 'Геометрия, м', 'Итого, м'], ...specs.cables.map(r => [r.brand, r.lines, r.geometry, r.total])];
  // Схема трасс: итоги по типам идут после пустой строки, поэтому фильтр накрывает
  // только строки трасс, а не итоги.
  const routeRows: Cell[][] = specs.routeSummary.routes.map(r => [r.number, r.type, routeSectionsText(r.sections, localizedNumber), r.length, r.segments, r.group === 'Кабель-канал' ? r.angles.total : null]);
  const routeSchemeRows: Cell[][] = [
    ['Трасса', 'Тип КНС', 'Сечения', 'Длина, м', 'Сегментов', 'Углы'],
    ...routeRows,
    [],
    ['Итого по типам', '', '', '', '', ''],
    ...specs.routeSummary.groups.map(g => [g.group, '', '', g.length, g.routes, g.group === 'Кабель-канал' ? g.angles.total : null]),
  ];
  const infrastructureRows: Cell[][] = [['Тип', 'Длина, м', 'Сегментов', 'Кабелей', 'Макс. заполнение, %', 'Сегментов с превышением'], ...specs.infrastructure.map(r => [r.type, r.length, r.segments, r.cables, r.maxFillPercent, r.overSegments])];
  const fillRows: Cell[][] = [['Трасса', 'Сегмент', 'Тип трассы', 'КНС, мм', 'Площадь КНС, мм²', 'Линий', 'Площадь кабелей, мм²', 'Заполнение, %', 'Статус'], ...specs.trayFill.map(r => [r.route, r.segment, r.routeType, r.tray, r.trayAreaMm2, r.lines, r.areaMm2, r.fillPercent, r.status])];
  const catalogRows: Cell[][] = [['Вид', 'Наименование', 'Ед.', 'Цена, ₽', 'Примечание'], ...(project.catalog ?? []).map(item => [PRICE_KIND_LABELS[item.kind] ?? item.kind, item.name, item.unit, item.price, item.note])];
  const pinRows: Cell[][] = [['Номер', 'Этаж', 'X', 'Y', 'Замечание', 'Статус', 'Фото'], ...(project.pins ?? []).map(pin => [pin.number, project.floors.find(floor => floor.id === pin.floorId)?.name || '—', pin.x, pin.y, pin.comment, pin.status === 'closed' ? 'закрыто' : 'открыто', (pin.photos || []).length])];
  // Доменные предупреждения (витая пара >100 м, нет цены кабеля, пустая трасса) и
  // предупреждения сметы дополняют проверку проекта; дубликаты убираем.
  const warningRows: Cell[][] = [['Предупреждение'], ...[...new Set([...validateProject(project), ...specs.errors, ...estimateResult.warnings, ...domainWarnings(project)])].map(e => [e])];

  return [
    { name: 'Кабельный журнал', rows: journal, table: wholeTable(journal) },
    { name: 'Оборудование', rows: equipmentRows, table: wholeTable(equipmentRows) },
    { name: 'Кабели', rows: cableRows, table: wholeTable(cableRows) },
    { name: 'Схема трасс', rows: routeSchemeRows, table: { fromRow: 0, toRow: routeRows.length } },
    // В «Спецификации КНС» и «Смете» итоги стоят среди данных: автофильтр
    // перемешал бы их, поэтому только закрепление шапки и ширины.
    { name: 'Спецификация КНС', rows: knsRows },
    { name: 'Инфраструктура', rows: infrastructureRows, table: wholeTable(infrastructureRows) },
    { name: 'Заполнение КНС', rows: fillRows, table: wholeTable(fillRows) },
    { name: 'Смета', rows: estimateRows },
    { name: 'Коммерческое предложение', rows: commercial, table: { fromRow: commercialFromRow, toRow: commercialToRow } },
    { name: 'Справочник цен', rows: catalogRows, table: wholeTable(catalogRows) },
    { name: 'Замечания', rows: pinRows, table: wholeTable(pinRows) },
    { name: 'Предупреждения', rows: warningRows, table: wholeTable(warningRows) },
  ];
}
