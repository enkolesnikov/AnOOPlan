import type { PriceItem, PriceKind, Project } from './model';
import { calculateCable, specifications } from './engine';

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
  return {
    id,
    kind: value.kind,
    name,
    unit: unit || 'шт',
    price: nonnegative(value.price) ? value.price : null,
    note: text(value.note),
  };
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

export interface EstimateLine {
  id: string;
  kind: PriceKind;
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
  laborPercent: number | null;
  labor: number | null;
  total: number | null;
  complete: boolean;
  catalogDate: string | null;
  warnings: string[];
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

function equipmentLines(project: Project): { lines: EstimateLine[]; warnings: string[] } {
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
    const total = price === null ? null : quantity * price;
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

function cableLines(project: Project): { lines: EstimateLine[]; warnings: string[] } {
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
    const total = quantity === null || price === null ? null : quantity * price;
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

function trayLines(project: Project): { lines: EstimateLine[]; warnings: string[] } {
  const catalog = project.catalog;
  const lines: EstimateLine[] = [];
  const warnings: string[] = [];
  for (const row of specifications(project).infrastructure) {
    const quantity = finite(row.length) ? row.length : null;
    const price = catalogItemPrice(catalogPrice(catalog, 'tray', row.type));
    const total = quantity === null || price === null ? null : quantity * price;
    if (quantity === null) warnings.push(`Смета: по трассе «${row.type}» неполный расчёт — длина неизвестна`);
    if (price === null) warnings.push(NO_PRICE(row.type));
    lines.push({
      id: `tray:${row.type}`,
      kind: 'tray',
      name: row.type,
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
 * Смета проекта по разделам: «Оборудование», «Кабели», «Лотки», «Работы».
 *
 * Материалы — сумма трёх материальных разделов; работы — `laborPercent` % от
 * материалов; итог — материалы + работы. Любое неизвестное значение делает
 * соответствующие строку/раздел/итог `null` (не 0) и добавляет предупреждение.
 * Функция не мутирует проект.
 */
export function estimate(project: Project): EstimateResult {
  const equipment = equipmentLines(project);
  const cables = cableLines(project);
  const trays = trayLines(project);

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

  const rawLaborPercent = project.estimate?.laborPercent;
  const laborPercent = nonnegative(rawLaborPercent) ? rawLaborPercent : null;
  if (rawLaborPercent !== undefined && rawLaborPercent !== null && laborPercent === null) {
    // Заданное, но некорректное значение не превращается в 0 и не игнорируется молча.
    worksWarnings.push('Смета: неверный процент работ');
  } else if (laborPercent === null) {
    worksWarnings.push('Смета: не задан процент работ');
  }
  let labor = materials !== null && laborPercent !== null ? materials * laborPercent / 100 : null;
  if (labor !== null && !Number.isFinite(labor)) {
    labor = null;
    worksWarnings.push('Смета: стоимость работ не является конечным числом');
  }
  let total = materials !== null && labor !== null ? materials + labor : null;
  if (total !== null && !Number.isFinite(total)) {
    total = null;
    worksWarnings.push('Смета: итог не является конечным числом');
  }
  // Работы — итоговая строка раздела: lines пусты, total — стоимость работ.
  const worksSection = makeSection('work', WORK_TITLE, [], worksWarnings);
  worksSection.total = labor;
  // Раздел работ рассчитан только когда известны и процент, и стоимость материалов.
  worksSection.complete = laborPercent !== null && materials !== null && labor !== null;

  const sections = [equipmentSection, cableSection, traySection, worksSection];
  return {
    sections,
    materials,
    laborPercent,
    labor,
    total,
    complete: sections.every(section => section.complete),
    catalogDate: normalizeCatalogDate(project.catalogDate),
    warnings: [...new Set(sections.flatMap(section => section.warnings))],
  };
}
