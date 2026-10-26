import type { Project } from '../model';
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

export interface KnSLine {
  name: string;
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
export interface KnSSpecification {
  lines: KnSLine[];
  totals: { group: string; length: number | null; angles: number }[];
  totalCost: number | null;
  warnings: string[];
}

/**
 * Спецификация КНС: агрегирует трассы по подсистеме, типу и сечению, добавляет
 * углы коробов и артикулы из справочника цен. Цены не подменяются нулём.
 */
export function specificationKnS(project: Project): KnSSpecification {
  const summary = routeSummary(project);
  const lines: KnSLine[] = [];
  const warnings: string[] = [];
  const catalog = project.catalog ?? [];
  for (const route of project.routes) {
    const row = summary.routes.find(item => item.id === route.id);
    if (!row) continue;
    const subsystem = routeSubsystemLabel(route);
    // Сечения могут различаться по сегментам: в спецификацию входит метраж каждого сечения.
    const sections = row.sections.length
      ? row.sections
      : [{ section: '—', length: row.length, segments: 0, overridden: false }];
    // Углы относятся к трассе целиком: для коробов относим их к основному сечению
    // (наибольший метраж), чтобы не задваивать количество углов в разных строках.
    const primary = sections.reduce((best, item, index) => ((item.length ?? -1) > (sections[best].length ?? -1) ? index : best), 0);
    sections.forEach((item, index) => {
      const angles = row.group === 'Кабель-канал' && index === primary ? row.angles.total : 0;
      const existing = lines.find(line => line.name === row.group && line.section === item.section && line.subsystem === subsystem);
      if (existing) {
        existing.quantity = existing.quantity === null || item.length === null ? null : existing.quantity + item.length;
        existing.angles += angles;
        existing.routes += 1;
        existing.cost = existing.quantity === null || existing.price === null ? null : existing.quantity * existing.price;
        return;
      }
      // Сначала ищем позицию по конкретному типу трассы, затем по группе (например, «Гофра»).
      const match = catalog.find(entry => entry.kind === 'tray' && entry.name.trim().toLowerCase() === route.type.trim().toLowerCase())
        ?? catalog.find(entry => entry.kind === 'tray' && entry.name.trim().toLowerCase() === row.group.trim().toLowerCase());
      lines.push({
        name: row.group,
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
  const totals: { group: string; length: number | null; angles: number }[] = [];
  for (const line of lines) {
    let group = totals.find(item => item.group === line.name);
    if (!group) { group = { group: line.name, length: 0, angles: 0 }; totals.push(group); }
    group.length = group.length === null || line.quantity === null ? null : group.length + line.quantity;
    group.angles += line.angles;
  }
  const complete = lines.length > 0 && lines.every(line => line.cost !== null);
  const totalCost = complete ? lines.reduce((sum, line) => sum + (line.cost as number), 0) : null;
  if (lines.some(line => line.price === null)) warnings.push('Для части КНС нет цены в справочнике — стоимость не рассчитана.');
  return { lines, totals, totalCost, warnings };
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
