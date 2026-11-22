import type { PriceItem, PriceKind, Project, WorkLine } from './model';
import { calculateCable, routeSummary } from './engine';
import { segmentIndex } from './engine/geometry';
import { resolveTrayPrice } from './engine/specification';
import { normalizeRounding, ROUNDING_STEPS, roundMoney } from './money';

/**
 * Смета проекта 1.17.0.
 *
 * Справочник цен живёт в самом проекте (`Project.catalog`), поэтому он входит в
 * JSON-копию и снимки: смена прайса в текущем проекте не пересчитывает историю.
 * Движок только читает проект (не мутирует его) и никогда не подменяет
 * неизвестную цену/количество нулём — такие строки и разделы дают `null`.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
/** Допустимая цена/количество: конечное число >= 0 (0 — известное значение). */
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const isPriceKind = (value: unknown): value is PriceKind =>
  value === 'equipment' || value === 'cable' || value === 'tray';

const CATALOG_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Строка-дата YYYY-MM-DD с реально существующей календарной датой. */
export function isCatalogDate(value: unknown): value is string {
  if (typeof value !== 'string' || !CATALOG_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Дата прайса: валидная строка YYYY-MM-DD или null (неизвестна). */
export function normalizeCatalogDate(value: unknown): string | null {
  return isCatalogDate(value) ? value : null;
}

/**
 * Одна позиция справочника цен из внешних данных (JSON-копия, импорт каталога).
 * Повреждённая запись отбрасывается (`null`), цена при нечисловом/отрицательном
 * значении становится `null`, а не 0.
 */
export function normalizePriceItem(value: unknown, index = 0): PriceItem | null {
  if (!isRecord(value)) return null;
  if (!isPriceKind(value.kind)) return null;
  const name = text(value.name).trim();
  if (!name) return null;
  const unit = text(value.unit).trim();
  const id = typeof value.id === 'string' && value.id.trim() ? value.id : `price-${index + 1}`;
  const item: PriceItem = {
    id,
    kind: value.kind,
    name,
    unit: unit || 'шт',
    price: nonnegative(value.price) ? value.price : null,
    note: text(value.note),
  };
  const manufacturer = text(value.manufacturer).trim();
  const article = text(value.article).trim();
  const series = text(value.series).trim();
  const size = text(value.size).trim();
  if (manufacturer) item.manufacturer = manufacturer;
  if (article) item.article = article;
  if (series) item.series = series;
  if (size) item.size = size;
  return item;
}

/** Справочник цен: не-массив трактуется как пустой, мусорные записи отбрасываются. */
export function normalizeCatalog(value: unknown): PriceItem[] {
  if (!Array.isArray(value)) return [];
  // Явные и fallback-id (`price-N`) могут пересечься: дубли ломают React-ключи и удаление
  // позиции в справочнике, поэтому разводим их детерминированно.
  const used = new Set<string>();
  const result: PriceItem[] = [];
  value.forEach((item, index) => {
    const normalized = normalizePriceItem(item, index);
    if (!normalized) return;
    let { id } = normalized;
    if (used.has(id)) {
      let suffix = index + 2;
      while (used.has(`price-${suffix}`)) suffix += 1;
      id = `price-${suffix}`;
    }
    used.add(id);
    result.push({ ...normalized, id });
  });
  return result;
}

/**
 * Поиск цены по виду и названию без учёта регистра и пробелов по краям.
 * Первое совпадение; `null` — позиция в справочнике не найдена.
 */
export function catalogPrice(catalog: PriceItem[] | undefined, kind: PriceKind, name: string): PriceItem | null {
  if (!Array.isArray(catalog) || !isPriceKind(kind)) return null;
  const target = text(name).trim().toLowerCase();
  if (!target) return null;
  for (const item of catalog) {
    if (item && item.kind === kind && typeof item.name === 'string' && item.name.trim().toLowerCase() === target) return item;
  }
  return null;
}

// Реализация живёт в `money.ts` (без импортов), чтобы спецификация КНС могла
// брать то же правило округления без циклического импорта; публичные имена
// остаются доступными из `estimate` для существующих потребителей.
/** @public */
export { normalizeRounding, ROUNDING_STEPS, roundMoney };

/**
 * Строка работ из внешних данных (JSON-копия, импорт): имя и единица обрезаются,
 * количество и цена — неотрицательное конечное число или null (неизвестно).
 * Не-объект отбрасывается; `id` — строка или детерминированный `work-N`.
 */
export function normalizeWorkLine(value: unknown, index = 0): WorkLine | null {
  if (!isRecord(value)) return null;
  const id = text(value.id).trim();
  return {
    id: id || `work-${index + 1}`,
    name: text(value.name).trim(),
    unit: text(value.unit).trim() || 'шт',
    quantity: nonnegative(value.quantity) ? value.quantity : null,
    price: nonnegative(value.price) ? value.price : null,
  };
}

/** Список работ: не-массив — пустой, битые элементы отбрасываются, дубли id разводятся. */
export function normalizeWorks(value: unknown): WorkLine[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  const result: WorkLine[] = [];
  value.forEach((item, index) => {
    const normalized = normalizeWorkLine(item, index);
    if (!normalized) return;
    let { id } = normalized;
    if (used.has(id)) {
      let suffix = index + 2;
      while (used.has(`work-${suffix}`)) suffix += 1;
      id = `work-${suffix}`;
    }
    used.add(id);
    result.push({ ...normalized, id });
  });
  return result;
}

export interface EstimateLine {
  id: string;
  kind: PriceKind | 'work';
  name: string;
  unit: string;
  quantity: number | null;
  price: number | null;
  total: number | null;
  priceSource: 'manual' | 'catalog' | null;
  note: string;
}

export interface EstimateSection {
  kind: PriceKind | 'work';
  title: string;
  lines: EstimateLine[];
  total: number | null;
  complete: boolean;
  warnings: string[];
}

export interface EstimateResult {
  sections: EstimateSection[];
  materials: number | null;
  /** Процент работ; в режиме работ по видам не применяется и равен null. */
  laborPercent: number | null;
  /** Стоимость работ: процент от материалов или итог раздела работ по видам. */
  labor: number | null;
  /** Итог ДО НДС (материалы + работы), уже округлённый при заданном `rounding`. */
  total: number | null;
  complete: boolean;
  catalogDate: string | null;
  warnings: string[];
  /** Нормализованные работы по видам; пустой список в режиме процента. */
  works: WorkLine[];
  worksMode: 'percent' | 'items';
  /** Ставка НДС, %; null — НДС не начисляется (не задан, 0 или неверен). */
  vatRate: number | null;
  vatIncluded: boolean;
  /** НДС; null — не начисляется или итог неизвестен. */
  vat: number | null;
  /** Итог с НДС: total + vat либо total, если цены уже включают НДС; null — итог неизвестен. */
  gross: number | null;
  /** Применённое правило округления денег; null — без округления. */
  rounding: number | null;
}

const EQUIPMENT_TITLE = 'Оборудование';
const CABLE_TITLE = 'Кабели';
const TRAY_TITLE = 'Лотки';
const WORK_TITLE = 'Работы';

const NO_PRICE = (name: string): string => `Смета: для «${name}» нет цены в справочнике`;

/** Цена из справочника без подмены нулём: позиция без цены — это «неизвестно». */
const catalogItemPrice = (item: PriceItem | null): number | null =>
  item && nonnegative(item.price) ? item.price : null;

/**
 * Раздел собирается из строк: пока у каждой строки известен итог, раздел полный
 * и его стоимость — сумма строк; иначе стоимость неизвестна (`null`).
 */
function makeSection(
  kind: PriceKind | 'work',
  title: string,
  lines: EstimateLine[],
  warnings: string[],
): EstimateSection {
  const totalsKnown = lines.every(line => line.total !== null);
  const sum = totalsKnown ? lines.reduce((acc, line) => acc + (line.total as number), 0) : null;
  const total = sum !== null && Number.isFinite(sum) ? sum : null;
  const sectionWarnings = [...warnings];
  if (sum !== null && total === null) sectionWarnings.push('Смета: стоимость раздела не является конечным числом');
  return { kind, title, lines, total, complete: totalsKnown && total !== null, warnings: [...new Set(sectionWarnings)] };
}

function equipmentLines(project: Project, rounding: number | null): { lines: EstimateLine[]; warnings: string[] } {
  const catalog = project.catalog;
  // Группировка по модели: properties.model, иначе name; порядок — по первому появлению.
  const counts = new Map<string, number>();
  for (const item of project.equipment) {
    const model = item.properties?.model || item.name;
    counts.set(model, (counts.get(model) ?? 0) + 1);
  }
  const lines: EstimateLine[] = [];
  const warnings: string[] = [];
  for (const [model, quantity] of counts) {
    const price = catalogItemPrice(catalogPrice(catalog, 'equipment', model));
    const total = price === null ? null : roundMoney(quantity * price, rounding);
    if (price === null) warnings.push(NO_PRICE(model));
    lines.push({
      id: `equipment:${model}`,
      kind: 'equipment',
      name: model,
      unit: 'шт',
      quantity,
      price,
      total,
      priceSource: price === null ? null : 'catalog',
      note: '',
    });
  }
  return { lines, warnings };
}

function cableLines(project: Project, rounding: number | null): { lines: EstimateLine[]; warnings: string[] } {
  const catalog = project.catalog;
  const lines: EstimateLine[] = [];
  const warnings: string[] = [];
  for (const cable of project.cables) {
    const calculation = calculateCable(project, cable);
    const validUnits = Number.isInteger(cable.quantity) && cable.quantity > 0;
    const quantity = calculation.complete && calculation.total !== null && validUnits
      ? calculation.total * cable.quantity
      : null;
    // Ручная цена кабеля приоритетнее справочника; некорректная не подменяется нулём.
    const manual = nonnegative(cable.pricePerMeter) ? cable.pricePerMeter : null;
    const fromCatalog = manual === null ? catalogItemPrice(catalogPrice(catalog, 'cable', cable.brand)) : null;
    const price = manual ?? fromCatalog;
    const priceSource: EstimateLine['priceSource'] = manual !== null ? 'manual' : price !== null ? 'catalog' : null;
    const total = quantity === null || price === null ? null : roundMoney(quantity * price, rounding);
    if (quantity === null) warnings.push(`Смета: по кабелю ${cable.number} неполный расчёт — количество неизвестно`);
    if (price === null) warnings.push(NO_PRICE(cable.brand || cable.name || cable.number));
    lines.push({
      id: `cable:${cable.id}`,
      kind: 'cable',
      name: `${cable.number} · ${cable.brand || cable.name}`,
      unit: 'м',
      quantity,
      price,
      total,
      priceSource,
      note: calculation.errors.join('; '),
    });
  }
  return { lines, warnings };
}

function trayLines(project: Project, rounding: number | null): { lines: EstimateLine[]; warnings: string[] } {
  const catalog = project.catalog;
  const lines: EstimateLine[] = [];
  const warnings: string[] = [];
  // Метраж агрегируется по типу и эффективному сечению: у одной трассы и даже
  // одной подсистемы могут быть разные лотки, и каждый оценивается своей ценой.
  const rows: { type: string; group: string; section: string; quantity: number | null }[] = [];
  // Дубли ID — уже невалидный проект; смета не должна молча удваивать метраж.
  const { duplicates } = segmentIndex(project);
  for (const route of routeSummary(project).routes) {
    // Пустая трасса не несёт материала: иначе она добавляет строку 0 м и,
    // если её типа нет в прайсе, обнуляет весь раздел «Лотки».
    if (!route.segments) continue;
    const source = project.routes.find(item => item.id === route.id);
    const duplicate = source?.segments.some(segment => duplicates.has(segment.id)) ?? false;
    const sections = route.sections.length
      ? route.sections
      : [{ section: '—', length: route.length, segments: 0, overridden: false }];
    for (const part of sections) {
      if (part.length === 0) continue;
      let row = rows.find(item => item.type === route.type && item.section === part.section);
      if (!row) { row = { type: route.type, group: route.group, section: part.section, quantity: 0 }; rows.push(row); }
      row.quantity = row.quantity === null || part.length === null || duplicate ? null : row.quantity + part.length;
    }
  }
  for (const row of rows) {
    const quantity = finite(row.quantity) ? row.quantity : null;
    // Как и спецификация КНС, допускаем позицию группы («Гофра» для «Гофра ПВХ»).
    let priceMatch = resolveTrayPrice(catalog, row.type, row.section);
    if (!priceMatch.item) {
      const byGroup = resolveTrayPrice(catalog, row.group, row.section);
      if (byGroup.item || !priceMatch.sizeMissing) priceMatch = byGroup;
    }
    const price = catalogItemPrice(priceMatch.item);
    const total = quantity === null || price === null ? null : roundMoney(quantity * price, rounding);
    if (quantity === null) warnings.push(`Смета: по трассе «${row.type}» неполный расчёт — длина неизвестна`);
    if (price === null) {
      warnings.push(priceMatch.sizeMissing
        ? `Смета: для «${row.type}» нет цены сечения ${row.section} в справочнике`
        : NO_PRICE(row.type));
    }
    // «—» — сечение неизвестно, поэтому в имени остаётся только тип.
    const name = row.section === '—' ? row.type : `${row.type} · ${row.section}`;
    lines.push({
      id: `tray:${row.type}:${row.section}`,
      kind: 'tray',
      name,
      unit: 'м',
      quantity,
      price,
      total,
      priceSource: price === null ? null : 'catalog',
      note: '',
    });
  }
  return { lines, warnings };
}

/**
 * Строки работ по видам: итог строки — количество × цена (иначе неизвестен).
 * Строка без имени — мусор: количество и цена считаются неизвестными, раздел неполный.
 */
function workLines(works: WorkLine[], rounding: number | null): { lines: EstimateLine[]; warnings: string[] } {
  const lines: EstimateLine[] = [];
  const warnings: string[] = [];
  works.forEach((work, index) => {
    const named = work.name.trim() !== '';
    const quantity = named && nonnegative(work.quantity) ? work.quantity : null;
    const price = named && nonnegative(work.price) ? work.price : null;
    const total = quantity === null || price === null ? null : roundMoney(quantity * price, rounding);
    const name = work.name || `Работа ${index + 1}`;
    if (total === null) warnings.push(`Смета: неполная строка работ «${name}»`);
    lines.push({
      id: `work:${work.id}`,
      kind: 'work',
      name,
      unit: work.unit || 'шт',
      quantity,
      price,
      total,
      priceSource: price === null ? null : 'manual',
      note: '',
    });
  });
  return { lines, warnings };
}

/**
 * Смета проекта по разделам: «Оборудование», «Кабели», «Лотки», «Работы».
 *
 * Материалы — сумма трёх материальных разделов. Работы — `laborPercent` % от
 * материалов либо, если задан непустой список `works`, итог работ по видам
 * (процент тогда не применяется). Итог `total` — материалы + работы ДО НДС;
 * НДС и итог с НДС (`gross`) считаются отдельно по `vatRate`/`vatIncluded`.
 * Денежные значения округляются по `rounding`; любое неизвестное значение делает
 * соответствующие строку/раздел/итог `null` (не 0) и добавляет предупреждение.
 * Функция не мутирует проект.
 */
export function estimate(project: Project): EstimateResult {
  // Правило округления общее для всей сметы. Заданный, но недопустимый шаг
  // (например 3) не применяется молча: значение остаётся неизвестным, есть предупреждение.
  const rawRounding = project.estimate?.rounding;
  const rounding = normalizeRounding(rawRounding);
  const moneyWarnings: string[] = [];
  if (rawRounding !== undefined && rawRounding !== null && rounding === null) {
    moneyWarnings.push('Смета: неверное правило округления');
  }

  // Непустой список работ включает режим по видам: процент работ игнорируется без предупреждения.
  const works = normalizeWorks(project.estimate?.works);
  const itemsMode = works.length > 0;

  const equipment = equipmentLines(project, rounding);
  const cables = cableLines(project, rounding);
  const trays = trayLines(project, rounding);

  const equipmentSection = makeSection('equipment', EQUIPMENT_TITLE, equipment.lines, equipment.warnings);
  const cableSection = makeSection('cable', CABLE_TITLE, cables.lines, cables.warnings);
  const traySection = makeSection('tray', TRAY_TITLE, trays.lines, trays.warnings);
  const materialSections = [equipmentSection, cableSection, traySection];

  const materialsKnown = materialSections.every(section => section.total !== null);
  let materials = materialsKnown
    ? materialSections.reduce((sum, section) => sum + (section.total as number), 0)
    : null;
  const worksWarnings: string[] = [];
  if (materials !== null && !Number.isFinite(materials)) {
    materials = null;
    worksWarnings.push('Смета: стоимость материалов не является конечным числом');
  }

  let laborPercent: number | null = null;
  let labor: number | null;
  let worksLines: EstimateLine[] = [];
  if (itemsMode) {
    const items = workLines(works, rounding);
    worksLines = items.lines;
    worksWarnings.push(...items.warnings);
    const totalsKnown = worksLines.length > 0 && worksLines.every(line => line.total !== null);
    const sum = totalsKnown ? worksLines.reduce((acc, line) => acc + (line.total as number), 0) : null;
    labor = sum !== null && Number.isFinite(sum) ? sum : null;
    if (sum !== null && labor === null) worksWarnings.push('Смета: стоимость раздела не является конечным числом');
  } else {
    const rawLaborPercent = project.estimate?.laborPercent;
    laborPercent = nonnegative(rawLaborPercent) ? rawLaborPercent : null;
    if (rawLaborPercent !== undefined && rawLaborPercent !== null && laborPercent === null) {
      // Заданное, но некорректное значение не превращается в 0 и не игнорируется молча.
      worksWarnings.push('Смета: неверный процент работ');
    } else if (laborPercent === null) {
      worksWarnings.push('Смета: не задан процент работ');
    }
    labor = materials !== null && laborPercent !== null ? roundMoney(materials * laborPercent / 100, rounding) : null;
    if (labor !== null && !Number.isFinite(labor)) {
      labor = null;
      worksWarnings.push('Смета: стоимость работ не является конечным числом');
    }
  }

  // Итог — точная сумма уже округлённых значений: повторное округление сдвигало бы
  // его относительно суммы разделов на ошибку представления.
  let total = materials !== null && labor !== null ? materials + labor : null;
  if (total !== null && !Number.isFinite(total)) {
    total = null;
    worksWarnings.push('Смета: итог не является конечным числом');
  }

  const worksSection = makeSection('work', WORK_TITLE, worksLines, worksWarnings);
  worksSection.total = labor;
  // В режиме процента раздел рассчитан, только если известны и процент, и материалы.
  worksSection.complete = itemsMode
    ? worksLines.length > 0 && labor !== null && worksLines.every(line => line.total !== null)
    : laborPercent !== null && materials !== null && labor !== null;

  // НДС: 0 и отсутствие ставки — не начисляется (это не ошибка и не делает смету неполной).
  const rawVatRate = project.estimate?.vatRate;
  let vatRate: number | null = null;
  let vatRateInvalid = false;
  if (rawVatRate !== undefined && rawVatRate !== null) {
    if (finite(rawVatRate) && rawVatRate >= 0 && rawVatRate <= 100) vatRate = rawVatRate;
    else {
      vatRateInvalid = true;
      moneyWarnings.push('Смета: неверная ставка НДС');
    }
  }
  const vatIncluded = project.estimate?.vatIncluded === true;
  let vat: number | null = null;
  let gross: number | null = total;
  if (vatRateInvalid) {
    // Ставка мусорная: НДС не начисляем, но и итог с НДС неизвестен.
    gross = null;
  } else if (vatRate !== null && vatRate > 0 && total !== null) {
    const raw = vatIncluded ? total * vatRate / (100 + vatRate) : total * vatRate / 100;
    const rounded = roundMoney(raw, rounding);
    if (Number.isFinite(rounded)) {
      vat = rounded;
      gross = vatIncluded ? total : total + vat;
    } else {
      gross = null;
      moneyWarnings.push('Смета: стоимость НДС не является конечным числом');
    }
  }
  const sections = [equipmentSection, cableSection, traySection, worksSection];
  const vatKnown = !vatRateInvalid && (vatRate === null || vatRate === 0 || vat !== null);
  return {
    sections,
    materials,
    laborPercent,
    labor,
    total,
    complete: sections.every(section => section.complete) && vatKnown,
    catalogDate: normalizeCatalogDate(project.catalogDate),
    warnings: [...new Set([...sections.flatMap(section => section.warnings), ...moneyWarnings])],
    works: itemsMode ? works : [],
    worksMode: itemsMode ? 'items' : 'percent',
    vatRate,
    vatIncluded,
    vat,
    gross,
    rounding,
  };
}
