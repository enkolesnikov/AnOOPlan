import type { PriceItem, Project } from '../model';
import { SECTION_DIM_KEYS, segmentSectionLabel } from '../route-kinds';
import { calculateCable, finite, reserveErrors, segmentErrors, segmentIndex, segmentLength } from './geometry';
import { routeSubsystemLabel, routeSummary } from './routes';
import type { TrayFillStatus } from './tray-fill';
import { invalidGivenDimension, isGiven, trayFill } from './tray-fill';

/**
 * Спецификации и проверки проекта: ведомость КНС, оборудование и кабели,
 * заполнение лотков, доменные предупреждения и валидация проекта. Вынесено
 * из `src/engine.ts` без изменения поведения.
 */

/**
 * Нормализация обозначения сечения для сравнения строки КНС с `PriceItem.size`:
 * без пробелов и регистра, `x`/`х`/`×` → `×`, `Ø`/`d`/`диаметр` → `d`. Ведущий `d`
 * у диаметра снимается, чтобы «Ø 20» и «20» совпадали с сечением «Ø20».
 */
export function normalizePriceSize(value: unknown): string {
  return (typeof value === 'string' ? value : '')
    .toLowerCase()
    .replace(/диаметр/g, 'd')
    .replace(/[ø⌀]/g, 'd')
    .replace(/[xх×]/g, '×')
    .replace(/²/g, '2')
    .replace(/мм2|мм/g, '')
    .replace(/[\s=]/g, '')
    .replace(/^s/, '')
    .replace(/^d(?=\d)/, '');
}

export interface TrayPriceResolution {
  /** Подходящая позиция справочника; null — цены нет. */
  item: PriceItem | null;
  /** У имени есть позиции с size, но ни одна не совпала с сечением строки. */
  sizeMissing: boolean;
}

/**
 * Подбор цены КНС по имени и сечению: точное совпадение `size` приоритетнее
 * позиции без size (она универсальна). Если у имени есть только позиции с size
 * и ни одна не подошла, возвращается `item: null` — первая цена не подставляется.
 */
export function resolveTrayPrice(catalog: PriceItem[] | undefined, name: string, section: string): TrayPriceResolution {
  const target = (typeof name === 'string' ? name : '').trim().toLowerCase();
  if (!target || !Array.isArray(catalog)) return { item: null, sizeMissing: false };
  const entries = catalog.filter(item =>
    item && item.kind === 'tray' && typeof item.name === 'string' && item.name.trim().toLowerCase() === target);
  if (!entries.length) return { item: null, sizeMissing: false };
  const wanted = normalizePriceSize(section);
  const sized = entries.filter(item => typeof item.size === 'string' && item.size.trim() !== '');
  const exact = sized.find(item => normalizePriceSize(item.size) === wanted);
  if (exact) return { item: exact, sizeMissing: false };
  const universal = entries.find(item => !(typeof item.size === 'string' && item.size.trim() !== ''));
  if (universal) return { item: universal, sizeMissing: false };
  return { item: null, sizeMissing: true };
}

export interface KnSLine {
  name: string;
  /** Конкретный тип трассы: «Лоток лестничный» и «Лоток перфорированный» — разные строки. */
  type?: string;
  section: string;
  subsystem: string;
  unit: string;
  quantity: number | null;
  angles: number;
  article: string;
  manufacturer: string;
  price: number | null;
  cost: number | null;
  routes: number;
}
/** Итог по типу КНС: сколько метров, углов и денег приходится на все строки типа. */
export interface KnSTypeTotal {
  group: string;
  /** Метраж, null если хотя бы одна строка без известной длины. */
  length: number | null;
  angles: number;
  /** Стоимость, null если хотя бы одна строка без цены. */
  cost: number | null;
}

/** Итог по подсистеме: метраж, углы, стоимость и число строк. */
export interface KnSSubsystemTotal {
  subsystem: string;
  /** Метраж, null если хотя бы одна длина неизвестна. */
  length: number | null;
  angles: number;
  /** Стоимость, null если хотя бы одна цена неизвестна. */
  cost: number | null;
  /** Число строк спецификации в подсистеме. */
  lines: number;
}

export interface KnSSpecification {
  /** Строки по подсистемам (порядок первого появления), затем тип и сечение. */
  lines: KnSLine[];
  totals: KnSTypeTotal[];
  /** Итоги по подсистемам в порядке первого появления. */
  subsystems: KnSSubsystemTotal[];
  /** Метраж всех строк; null если хоть одна длина неизвестна, 0 без строк. */
  totalLength: number | null;
  totalCost: number | null;
  warnings: string[];
}

/** Прибавление к итогу: любое неизвестное слагаемое делает итог неизвестным. */
const addKnown = (sum: number | null, value: number | null): number | null =>
  sum === null || value === null ? null : sum + value;

/** Сумма ряда: null, если хоть одно значение неизвестно; пустой ряд — 0, а не «неизвестно». */
function sumKnown(values: (number | null)[]): number | null {
  let sum = 0;
  for (const value of values) {
    if (value === null) return null;
    sum += value;
  }
  return sum;
}

/**
 * Спецификация КНС: агрегирует трассы по подсистеме, типу и сечению, добавляет
 * углы коробов и артикулы из справочника цен. Цены не подменяются нулём.
 */
export function specificationKnS(project: Project): KnSSpecification {
  const summary = routeSummary(project);
  const lines: KnSLine[] = [];
  const warnings: string[] = [];
  // Подсистемы запоминаются в порядке первого появления трасс: так же группируются строки.
  const subsystemOrder: string[] = [];
  const catalog = project.catalog ?? [];
  for (const route of project.routes) {
    const row = summary.routes.find(item => item.id === route.id);
    if (!row || !route.segments.length) continue;
    const subsystem = routeSubsystemLabel(route);
    if (!subsystemOrder.includes(subsystem)) subsystemOrder.push(subsystem);
    // Сечения могут различаться по сегментам: в спецификацию входит метраж каждого сечения.
    const sections = row.sections.length
      ? row.sections
      : [{ section: '—', length: row.length, segments: 0, overridden: false }];
    // Углы относятся к трассе целиком: для коробов относим их к основному сечению
    // (наибольший метраж), чтобы не задваивать количество углов в разных строках.
    const primary = sections.reduce((best, item, index) => ((item.length ?? -1) > (sections[best].length ?? -1) ? index : best), 0);
    sections.forEach((item, index) => {
      // Нулевой участок не несёт материала и не должен делать строку с ценой неизвестной.
      if (item.length === 0) return;
      const angles = row.group === 'Кабель-канал' && index === primary ? row.angles.total : 0;
      const typeName = route.type.trim() || row.group;
      const existing = lines.find(line => line.name === typeName && line.section === item.section && line.subsystem === subsystem);
      if (existing) {
        existing.quantity = existing.quantity === null || item.length === null ? null : existing.quantity + item.length;
        existing.angles += angles;
        existing.routes += 1;
        existing.cost = existing.quantity === null || existing.price === null ? null : existing.quantity * existing.price;
        return;
      }
      // Сначала ищем позицию по конкретному типу трассы и сечению, затем по группе (например, «Гофра»).
      // Позиция с чужим size не подменяется первой ценой: такая строка остаётся без цены.
      let priceMatch = resolveTrayPrice(catalog, route.type, item.section);
      if (!priceMatch.item) {
        // Группа может дать точное сечение, даже если у своего типа был только чужой size.
        const byGroup = resolveTrayPrice(catalog, row.group, item.section);
        if (byGroup.item || !priceMatch.sizeMissing) priceMatch = byGroup;
      }
      const match = priceMatch.item;
      if (priceMatch.sizeMissing) {
        warnings.push(`КНС: для «${typeName}» нет цены сечения ${item.section} в справочнике`);
      }
      lines.push({
        name: typeName,
        type: route.type,
        section: item.section,
        subsystem,
        unit: 'м',
        quantity: item.length,
        angles,
        article: match?.article ?? '',
        manufacturer: match?.manufacturer ?? '',
        price: match?.price ?? null,
        cost: item.length === null || !match || match.price === null ? null : item.length * match.price,
        routes: 1,
      });
    });
  }
  // Детерминированный порядок строк: подсистема (порядок первого появления), тип, сечение.
  // Так PDF и XLSX печатают подсистемы блоками, а не в порядке трасс.
  const subsystemRank = new Map(subsystemOrder.map((name, index) => [name, index]));
  const compareSection = (left: string, right: string): number => left.localeCompare(right, 'ru', { numeric: true });
  lines.sort((left, right) => {
    const bySubsystem = (subsystemRank.get(left.subsystem) ?? 0) - (subsystemRank.get(right.subsystem) ?? 0);
    if (bySubsystem) return bySubsystem;
    const byName = left.name.localeCompare(right.name, 'ru');
    return byName || compareSection(left.section, right.section);
  });
  const totals: KnSTypeTotal[] = [];
  for (const line of lines) {
    let group = totals.find(item => item.group === line.name);
    if (!group) { group = { group: line.name, length: 0, angles: 0, cost: 0 }; totals.push(group); }
    group.length = addKnown(group.length, line.quantity);
    group.angles += line.angles;
    group.cost = addKnown(group.cost, line.cost);
  }
  const subsystems: KnSSubsystemTotal[] = [];
  for (const line of lines) {
    let group = subsystems.find(item => item.subsystem === line.subsystem);
    if (!group) { group = { subsystem: line.subsystem, length: 0, angles: 0, cost: 0, lines: 0 }; subsystems.push(group); }
    group.length = addKnown(group.length, line.quantity);
    group.angles += line.angles;
    group.cost = addKnown(group.cost, line.cost);
    group.lines += 1;
  }
  // Нет строк — нет материалов: 0, а не «неизвестно»; одна неизвестная длина/цена даёт null.
  const totalLength = sumKnown(lines.map(line => line.quantity));
  const totalCost = sumKnown(lines.map(line => line.cost));
  if (lines.some(line => line.price === null)) warnings.push('Для части КНС нет цены в справочнике — стоимость не рассчитана.');
  return { lines, totals, subsystems, totalLength, totalCost, warnings };
}

export interface TrayFillRow {
  route: string;
  segment: string;
  routeType: string;
  tray: string;
  trayAreaMm2: number | null;
  lines: number;
  areaMm2: number | null;
  fillPercent: number | null;
  status: 'ок' | 'внимание' | 'превышено' | 'пусто' | 'неполный';
  /** Сечение взято с сегмента, а не с трассы. */
  overridden: boolean;
}

const TRAY_STATUS_LABELS: Record<TrayFillStatus, TrayFillRow['status']> = {
  ok: 'ок',
  warning: 'внимание',
  over: 'превышено',
  empty: 'пусто',
  incomplete: 'неполный',
};

export function specifications(project: Project) {
  const equipment: { type: string; model: string; floor: string; quantity: number }[] = [];
  for (const item of project.equipment) {
    const model = item.properties.model || item.name;
    const floor = project.floors.find(f => f.id === item.floorId)?.name ?? item.floorId;
    const group = equipment.find(g => g.type === item.type && g.model === model && g.floor === floor);
    if (group) group.quantity++;
    else equipment.push({ type: item.type, model, floor, quantity: 1 });
  }
  const cables: { brand: string; lines: number; geometry: number | null; total: number | null }[] = [];
  const errors: string[] = [];
  for (const cable of project.cables) {
    const calculation = calculateCable(project, cable);
    errors.push(...calculation.errors);
    let group = cables.find(g => g.brand === cable.brand);
    if (!group) { group = { brand: cable.brand, lines: 0, geometry: 0, total: 0 }; cables.push(group); }
    const validQuantity = Number.isInteger(cable.quantity) && cable.quantity > 0;
    if (validQuantity) group.lines += cable.quantity;
    group.geometry = group.geometry === null || calculation.geometry === null || !validQuantity ? null : group.geometry + calculation.geometry * cable.quantity;
    group.total = group.total === null || calculation.total === null || !validQuantity ? null : group.total + calculation.total * cable.quantity;
  }
  const infrastructure: { type: string; length: number | null; segments: number; cables: number; maxFillPercent: number | null; overSegments: number }[] = [];
  const { duplicates } = segmentIndex(project);
  const seen = new Set<string>();
  for (const route of project.routes) {
    let group = infrastructure.find(g => g.type === route.type);
    if (!group) { group = { type: route.type, length: 0, segments: 0, cables: 0, maxFillPercent: null, overSegments: 0 }; infrastructure.push(group); }
    for (const segment of route.segments) {
      if (duplicates.has(segment.id)) { group.length = null; errors.push(`Неоднозначный ID сегмента ${segment.id}`); }
      if (seen.has(segment.id)) continue;
      seen.add(segment.id);
      group.segments++;
      const length = segmentLength(project, segment);
      if (length === null) errors.push(...segmentErrors(project, segment));
      group.length = group.length === null || length === null ? null : group.length + length;
    }
  }
  for (const group of infrastructure) {
    const ids = new Set(project.routes.filter(r => r.type === group.type).flatMap(r => r.segments.map(s => s.id)));
    group.cables = project.cables.filter(c => c.segmentIds.some(id => ids.has(id))).reduce((sum, c) => sum + (Number.isInteger(c.quantity) && c.quantity > 0 ? c.quantity : 0), 0);
  }
  const fill = trayFill(project);
  const trayFillRows: TrayFillRow[] = [];
  // Строки заполнения идут в том же порядке, что сегменты; связываем по id, а не по индексу.
  const fillBySegment = new Map(fill.segments.map(row => [row.segmentId, row]));
  for (const route of project.routes) {
    route.segments.forEach((segment, index) => {
      const segmentFill = fillBySegment.get(segment.id);
      trayFillRows.push({
        route: route.number,
        segment: `${route.number}.${index + 1}`,
        routeType: route.type,
        tray: segmentSectionLabel(route, segment),
        trayAreaMm2: segmentFill?.trayAreaMm2 ?? null,
        lines: segmentFill?.lines ?? 0,
        areaMm2: segmentFill?.usedAreaMm2 ?? null,
        fillPercent: segmentFill?.fillPercent ?? null,
        status: TRAY_STATUS_LABELS[segmentFill?.status ?? 'incomplete'],
        overridden: segmentFill?.overridden ?? false,
      });
    });
  }
  for (const group of infrastructure) {
    const typeSegments = fill.segments.filter(segment => segment.routeType === group.type);
    const known = typeSegments.map(segment => segment.fillPercent).filter((value): value is number => value !== null);
    group.maxFillPercent = known.length ? Math.max(...known) : null;
    group.overSegments = typeSegments.filter(segment => segment.status === 'over').length;
  }
  return { equipment, cables, infrastructure, trayFill: trayFillRows, routeSummary: routeSummary(project), errors: [...new Set(errors)] };
}

/** Доменные предупреждения: не мешают расчёту, но важны для сдачи документации. */
export function domainWarnings(project: Project): string[] {
  const warnings: string[] = [];
  for (const cable of project.cables) {
    const calculation = calculateCable(project, cable);
    const brand = `${cable.brand} ${cable.name}`.toLowerCase();
    const twistedPair = /utp|ftp|stp|витая|патч/.test(brand);
    if (twistedPair && calculation.total !== null && calculation.total > 100) {
      warnings.push(`Кабель ${cable.number}: ${Math.round(calculation.total)} м — витая пара длиннее 100 м требует усилителя или оптики`);
    }
    if (calculation.pricePerMeter === null) warnings.push(`Кабель ${cable.number}: не задана цена за метр — смета неполная`);
    else if (calculation.cost === null) warnings.push(`Кабель ${cable.number}: стоимость не рассчитана, проверьте количество и расчёт`);
  }
  for (const route of project.routes) {
    if (!route.segments.length) warnings.push(`Трасса ${route.number}: нет сегментов`);
  }
  for (const warning of trayFill(project).warnings) {
    if (!warnings.includes(warning)) warnings.push(warning);
  }
  return [...new Set(warnings)];
}

export function validateProject(project: Project): string[] {
  const errors: string[] = [];
  if (project.schemaVersion !== 1 && project.schemaVersion !== 2) errors.push('Неподдерживаемая версия проекта');
  for (const [name, items] of [['этажа', project.floors], ['оборудования', project.equipment], ['трассы', project.routes], ['кабеля', project.cables], ['замечания', (project.pins ?? [])]] as const) {
    const seen = new Set<string>();
    for (const item of items) {
      if (!item.id || seen.has(item.id)) errors.push(`Пустой или повторяющийся ID ${name}: ${item.id}`);
      seen.add(item.id);
    }
  }
  const uniqueFields = (items: { number: string; name?: string }[], at: string) => {
    const numbers = new Set<string>();
    const names = new Set<string>();
    for (const item of items) {
      const n = (item.number || '').trim();
      if (n && numbers.has(n)) errors.push(`Повторный номер ${at}: ${n}`);
      if (n) numbers.add(n);
      const name = (item.name || '').trim();
      if (name && names.has(name)) errors.push(`Повторное имя ${at}: ${name}`);
      if (name) names.add(name);
    }
  };
  uniqueFields(project.equipment, 'оборудования');
  uniqueFields(project.routes, 'трассы');
  uniqueFields(project.cables, 'кабеля');
  uniqueFields(project.pins ?? [], 'замечания');
  const floorIds = new Set(project.floors.map(floor => floor.id));
  for (const pin of project.pins ?? []) {
    if (!floorIds.has(pin.floorId)) errors.push(`Замечание ${pin.number}: этаж не найден`);
    if (pin.status !== 'open' && pin.status !== 'closed') errors.push(`Замечание ${pin.number}: неизвестный статус`);
  }
  for (const floor of project.floors) {
    if (!finite(floor.metersPerUnit) || floor.metersPerUnit <= 0) errors.push(`Этаж ${floor.name}: неизвестен или неверен масштаб`);
    if (!finite(floor.elevation)) errors.push(`Этаж ${floor.name}: неизвестна отметка`);
  }
  for (const item of project.equipment) {
    if (!project.floors.some(f => f.id === item.floorId)) errors.push(`Оборудование ${item.number}: отсутствует этаж`);
    if (!finite(item.height)) errors.push(`Оборудование ${item.number}: неизвестна высота`);
    if (!finite(item.x) || !finite(item.y)) errors.push(`Оборудование ${item.number}: неверные координаты`);
  }
  const { duplicates } = segmentIndex(project);
  for (const id of duplicates) errors.push(`Неоднозначный ID сегмента ${id}`);
  for (const route of project.routes) {
    if (SECTION_DIM_KEYS.some(key => invalidGivenDimension(route[key]))) errors.push(`Трасса ${route.number}: неверное сечение КНС`);
    route.segments.forEach((segment, index) => {
      // Переопределение сечения на сегменте проверяется так же, как размеры трассы.
      if (SECTION_DIM_KEYS.some(key => invalidGivenDimension(segment[key]))) {
        errors.push(`Трасса ${route.number}, сегмент ${route.number}.${index + 1}: неверное сечение КНС`);
      }
      errors.push(...segmentErrors(project, segment), ...reserveErrors(`Сегмент ${segment.id}`, segment.reservePercent, segment.reserveFixed));
    });
  }
  for (const cable of project.cables) {
    const outerDiameterMm = cable.outerDiameterMm;
    if (isGiven(outerDiameterMm) && (!finite(outerDiameterMm) || outerDiameterMm <= 0)) errors.push(`Кабель ${cable.number}: неверный внешний диаметр`);
    const crossSectionMm2 = cable.crossSectionMm2;
    if (isGiven(crossSectionMm2) && (!finite(crossSectionMm2) || crossSectionMm2 <= 0)) errors.push(`Кабель ${cable.number}: неверная площадь сечения`);
    errors.push(...calculateCable(project, cable).errors);
  }
  return [...new Set(errors)];
}
