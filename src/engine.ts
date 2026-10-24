import type { Cable, Dimension, Equipment, Project, Route, Segment, Vertex } from './model';
import { isDiameterRoute, routeKindOf } from './route-kinds';

const EPS = 1e-6;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const near = (a: number, b: number) => finite(a) && finite(b) && Math.abs(a - b) <= EPS;
const samePlan = (a: Pick<Vertex, 'floorId' | 'x' | 'y'>, b: Pick<Vertex, 'floorId' | 'x' | 'y'>) =>
  a.floorId === b.floorId && near(a.x, b.x) && near(a.y, b.y);
const sameVertex = (a: Vertex, b: Vertex) => samePlan(a, b) && finite(a.height) && finite(b.height) && near(a.height, b.height);

function segmentErrors(project: Project, segment: Segment): string[] {
  const errors: string[] = [];
  const prefix = `Сегмент ${segment.id}`;
  const aFloor = project.floors.find(f => f.id === segment.a.floorId);
  const bFloor = project.floors.find(f => f.id === segment.b.floorId);
  for (const [vertex, floor] of [[segment.a, aFloor], [segment.b, bFloor]] as const) {
    if (!floor) errors.push(`${prefix}: отсутствует этаж ${vertex.floorId}`);
    else {
      if (!finite(floor.metersPerUnit) || floor.metersPerUnit <= 0) errors.push(`${prefix}: неизвестен или неверен масштаб этажа ${floor.id}`);
      if (!finite(floor.elevation)) errors.push(`${prefix}: неизвестна отметка этажа ${floor.id}`);
    }
    if (!finite(vertex.x) || !finite(vertex.y)) errors.push(`${prefix}: неверные координаты`);
    if (!finite(vertex.height)) errors.push(`${prefix}: неизвестна высота вершины ${vertex.id}`);
  }
  if (segment.mode !== 'orthogonal' && segment.mode !== 'spatial') errors.push(`${prefix}: неизвестный режим`);
  if (segment.a.floorId !== segment.b.floorId) {
    if (!near(segment.a.x, segment.b.x) || !near(segment.a.y, segment.b.y)) errors.push(`${prefix}: межэтажный переход должен быть вертикальным`);
    if (!finite(aFloor?.elevation) || !finite(bFloor?.elevation)) errors.push(`${prefix}: неизвестна отметка этажа`);
  } else if (segment.mode === 'orthogonal' && !near(segment.a.x, segment.b.x) && !near(segment.a.y, segment.b.y)) {
    errors.push(`${prefix}: ортогональный участок одновременно изменяет x и y`);
  }
  return errors;
}

/** Physical length in metres, without any reserve or quantity multiplier. */
export function segmentLength(project: Project, segment: Segment): number | null {
  if (segmentErrors(project, segment).length) return null;
  const aFloor = project.floors.find(f => f.id === segment.a.floorId)!;
  const bFloor = project.floors.find(f => f.id === segment.b.floorId)!;
  const heightA = segment.a.height!;
  const heightB = segment.b.height!;
  let result: number;
  if (aFloor.id !== bFloor.id) {
    result = Math.abs(bFloor.elevation! + heightB - aFloor.elevation! - heightA);
  } else {
    const dx = (segment.b.x - segment.a.x) * aFloor.metersPerUnit!;
    const dy = (segment.b.y - segment.a.y) * aFloor.metersPerUnit!;
    const dz = heightB - heightA;
    result = segment.mode === 'spatial' ? Math.hypot(dx, dy, dz) : Math.hypot(dx, dy) + Math.abs(dz);
  }
  return finite(result) ? result : null;
}

function segmentIndex(project: Project) {
  const segments = new Map<string, Segment>();
  const duplicates = new Set<string>();
  for (const route of project.routes) for (const segment of route.segments) {
    if (segments.has(segment.id)) duplicates.add(segment.id);
    else segments.set(segment.id, segment);
  }
  return { segments, duplicates };
}

export function chainEnds(project: Project, segmentIds: string[]): { start: Vertex; end: Vertex } | null {
  const { segments: index } = segmentIndex(project);
  const chain: Segment[] = [];
  for (const id of segmentIds) {
    const segment = index.get(id);
    if (!segment) return null;
    chain.push(segment);
  }
  if (!chain.length) return null;
  for (const reverse of [false, true]) {
    let start = reverse ? chain[0].b : chain[0].a;
    let end = reverse ? chain[0].a : chain[0].b;
    let connected = true;
    for (const segment of chain.slice(1)) {
      if (sameVertex(end, segment.a)) end = segment.b;
      else if (sameVertex(end, segment.b)) end = segment.a;
      else { connected = false; break; }
    }
    if (connected) return { start, end };
  }
  return null;
}

/** Finds a route across drawn segments between two pieces of equipment (BFS by segment count). */
export function findRoute(project: Project, fromId: string, toId: string): { segmentIds: string[]; error?: string } {
  const from = project.equipment.find(e => e.id === fromId);
  const to = project.equipment.find(e => e.id === toId);
  if (!from || !to) return { segmentIds: [], error: 'Оборудование не найдено.' };

  const key = (floorId: string, x: number, y: number) => `${floorId}|${x.toFixed(3)}|${y.toFixed(3)}`;
  const adjacency = new Map<string, { segmentId: string; other: string; weight: number }[]>();
  const positions = new Map<string, { floorId: string; x: number; y: number }>();
  const weightOf = (segment: Segment) => { const length = segmentLength(project, segment); return length === null ? 1 : Math.max(length, 1e-6); };

  for (const route of project.routes) {
    for (const segment of route.segments) {
      const ka = key(segment.a.floorId, segment.a.x, segment.a.y);
      const kb = key(segment.b.floorId, segment.b.x, segment.b.y);
      const weight = weightOf(segment);
      if (!adjacency.has(ka)) { adjacency.set(ka, []); positions.set(ka, { floorId: segment.a.floorId, x: segment.a.x, y: segment.a.y }); }
      if (!adjacency.has(kb)) { adjacency.set(kb, []); positions.set(kb, { floorId: segment.b.floorId, x: segment.b.x, y: segment.b.y }); }
      adjacency.get(ka)!.push({ segmentId: segment.id, other: kb, weight });
      adjacency.get(kb)!.push({ segmentId: segment.id, other: ka, weight });
    }
  }

  const nearest = (eq: Equipment): string | null => {
    let best: { k: string; d: number } | null = null;
    for (const [k, pos] of positions) {
      if (pos.floorId !== eq.floorId) continue;
      const d = Math.hypot(pos.x - eq.x, pos.y - eq.y);
      if (!best || d < best.d) best = { k, d };
    }
    return best?.k ?? null;
  };

  const start = nearest(from);
  const end = nearest(to);
  if (!start || !end) return { segmentIds: [], error: 'На плане нет трассы для маршрута.' };
  if (start === end) return { segmentIds: [], error: 'Оба устройства подключены к одной точке трассы.' };

  // Дейкстра по физической длине: путь с минимумом участков мог оказаться длиннее обхода.
  const shortest = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, { node: string; segmentId: string } | null>([[start, null]]);
  const visited = new Set<string>();
  // Пока есть непосещённые достижимые узлы: Дейкстра завершится, когда все они обработаны.
  while (visited.size < shortest.size) {
    let current: string | null = null;
    let best = Infinity;
    for (const [node, distance] of shortest) if (!visited.has(node) && distance < best) { best = distance; current = node; }
    if (!current) break;
    visited.add(current);
    if (current === end) break;
    for (const edge of adjacency.get(current) ?? []) {
      if (visited.has(edge.other)) continue;
      const candidate = best + edge.weight;
      if (candidate < (shortest.get(edge.other) ?? Infinity)) {
        shortest.set(edge.other, candidate);
        prev.set(edge.other, { node: current, segmentId: edge.segmentId });
      }
    }
  }

  if (!shortest.has(end)) return { segmentIds: [], error: 'Между устройствами нет непрерывной трассы. Соедините трассы между собой.' };

  const segmentIds: string[] = [];
  let node: string | null = end;
  while (node !== null) {
    const parent = prev.get(node);
    if (!parent) break;
    segmentIds.unshift(parent.segmentId);
    node = parent.node;
  }
  return { segmentIds };
}

function reserveErrors(owner: string, percent: number, fixed: number): string[] {
  return nonnegative(percent) && nonnegative(fixed) ? [] : [`${owner}: запасы должны быть конечными неотрицательными числами`];
}

export interface CableCalculation {
  complete: boolean;
  errors: string[];
  geometry: number | null;
  routeReserve: number;
  cableReserve: number;
  endReserve: number;
  total: number | null;
  pricePerMeter: number | null;
  cost: number | null;
  segments: { id: string; length: number | null }[];
}

export function calculateCable(project: Project, cable: Cable): CableCalculation {
  const errors: string[] = [];
  const { segments: index, duplicates } = segmentIndex(project);
  const equipment = (id: string) => project.equipment.find(item => item.id === id);
  const from = equipment(cable.fromId);
  const to = equipment(cable.toId);
  for (const [label, item] of [['начала', from], ['конца', to]] as const) {
    if (!item) errors.push(`Отсутствует оборудование ${label} кабеля ${cable.number}`);
    else {
      if (!project.floors.some(f => f.id === item.floorId)) errors.push(`Оборудование ${item.number}: отсутствует этаж`);
      if (!finite(item.height)) errors.push(`Оборудование ${item.number}: неизвестна высота`);
      if (!finite(item.x) || !finite(item.y)) errors.push(`Оборудование ${item.number}: неверные координаты`);
      if (project.equipment.filter(e => e.id === item.id).length > 1) errors.push(`Повтор ID оборудования ${item.id}`);
    }
  }
  errors.push(...reserveErrors(`Кабель ${cable.number}`, cable.reservePercent, cable.reserveFixed));
  if (!nonnegative(cable.startReserve) || !nonnegative(cable.endReserve)) errors.push(`Кабель ${cable.number}: неверные концевые запасы`);
  if (!Number.isInteger(cable.quantity) || cable.quantity <= 0) errors.push(`Кабель ${cable.number}: количество должно быть положительным целым`);
  if (!cable.segmentIds.length) errors.push(`Кабель ${cable.number}: не задана цепочка сегментов`);
  const seen = new Set<string>();
  let routeReserve = 0;
  let segmentGeometry = 0;
  const chain: Segment[] = [];
  const results = cable.segmentIds.map(id => {
    if (seen.has(id)) errors.push(`Кабель ${cable.number}: повтор сегмента ${id}`);
    seen.add(id);
    const segment = index.get(id);
    if (!segment) {
      errors.push(`Отсутствует сегмент ${id}`);
      return { id, length: null };
    }
    if (duplicates.has(id)) errors.push(`Неоднозначный ID сегмента ${id}`);
    chain.push(segment);
    errors.push(...segmentErrors(project, segment));
    errors.push(...reserveErrors(`Сегмент ${id}`, segment.reservePercent, segment.reserveFixed));
    const length = segmentLength(project, segment);
    if (length === null && !segmentErrors(project, segment).length) errors.push(`Сегмент ${id}: длина не является конечным числом`);
    if (length !== null) {
      segmentGeometry += length;
      if (nonnegative(segment.reservePercent) && nonnegative(segment.reserveFixed)) routeReserve += length * segment.reservePercent / 100 + segment.reserveFixed;
    }
    return { id, length };
  });

  let leads = 0;
  if (from && to && chain.length === cable.segmentIds.length && chain.length) {
    // The stored direction of any segment is independent of traversal direction.
    let oriented: { start: Vertex; end: Vertex } | undefined;
    for (const reverse of [false, true]) {
      const start = reverse ? chain[0].b : chain[0].a;
      if (!samePlan(from, start)) continue;
      let end = reverse ? chain[0].a : chain[0].b;
      let connected = true;
      for (const segment of chain.slice(1)) {
        if (sameVertex(end, segment.a)) end = segment.b;
        else if (sameVertex(end, segment.b)) end = segment.a;
        else { connected = false; break; }
      }
      if (connected && samePlan(to, end)) { oriented = { start, end }; break; }
    }
    if (!oriented) {
      const ends = chainEnds(project, cable.segmentIds);
      if (!ends) errors.push(`Кабель ${cable.number}: выбранные сегменты не образуют непрерывную цепочку. Выберите их по порядку от начала к концу.`);
      else errors.push(`Кабель ${cable.number}: концы трассы не совпадают с оборудованием «От»/«До». Начертите трассу, начиная и заканчивая на устройствах, или подвиньте устройства к концам трассы.`);
    }
    else if (finite(from.height) && finite(to.height) && finite(oriented.start.height) && finite(oriented.end.height)) {
      leads = Math.abs(from.height - oriented.start.height) + Math.abs(to.height - oriented.end.height);
    }
  }
  const geometry = errors.length ? null : segmentGeometry + leads;
  const cableReserve = geometry !== null ? geometry * cable.reservePercent / 100 + cable.reserveFixed : 0;
  const endReserve = nonnegative(cable.startReserve) && nonnegative(cable.endReserve) ? cable.startReserve + cable.endReserve : 0;
  const total = geometry === null ? null : geometry + routeReserve + cableReserve + endReserve;
  if (total !== null && !finite(total)) errors.push(`Кабель ${cable.number}: итог не является конечным числом`);
  // Смета не подменяется нулём: без цены или без полного расчёта стоимость неизвестна.
  const pricePerMeter = nonnegative(cable.pricePerMeter) ? cable.pricePerMeter : null;
  const validQuantity = Number.isInteger(cable.quantity) && cable.quantity > 0;
  const completeTotal = errors.length ? null : total;
  const cost = completeTotal === null || pricePerMeter === null || !validQuantity ? null : completeTotal * cable.quantity * pricePerMeter;
  return { complete: errors.length === 0, errors: [...new Set(errors)], geometry: errors.length ? null : geometry, routeReserve, cableReserve, endReserve, total: completeTotal, pricePerMeter, cost, segments: results };
}

/** Рекомендуемое заполнение лотка, % от площади сечения. */
export const TRAY_FILL_RECOMMENDED_PERCENT = 40;
/** Предельно допустимое заполнение лотка, % от площади сечения. */
export const TRAY_FILL_LIMIT_PERCENT = 50;
/** Допуск на погрешность вычислений при сравнении с границами 40/50 %. */
const TRAY_FILL_BOUNDARY_EPS = 1e-9;

export type TrayFillStatus = 'ok' | 'warning' | 'over' | 'empty' | 'incomplete';

export interface CableSection {
  areaMm2: number | null;
  source: 'area' | 'diameter' | null;
  errors: string[];
}

export interface SegmentFill {
  segmentId: string;
  routeId: string;
  routeNumber: string;
  routeType: string;
  trayWidthMm: number | null;
  trayHeightMm: number | null;
  trayAreaMm2: number | null;
  cables: number;
  lines: number;
  unknownCables: number;
  usedAreaMm2: number | null;
  fillPercent: number | null;
  status: TrayFillStatus;
  warnings: string[];
}

export interface TrayFillResult {
  segments: SegmentFill[];
  complete: boolean;
  maxFillPercent: number | null;
  overSegments: number;
  warnings: string[];
}

const isGiven = (value: unknown): boolean => value !== undefined && value !== null;
const givenNumber = (value: unknown): number | null => (isGiven(value) && finite(value) ? value : null);

/** Площадь внешнего сечения кабеля: crossSectionMm2 приоритетнее outerDiameterMm. */
export function cableSection(cable: Cable): CableSection {
  const prefix = `Кабель ${cable.number}`;
  if (isGiven(cable.crossSectionMm2)) {
    const area = cable.crossSectionMm2;
    // Некорректное значение не подменяется диаметром: иначе неверные данные стали бы «расчётом».
    if (!finite(area) || area <= 0) return { areaMm2: null, source: null, errors: [`${prefix}: неверная площадь сечения`] };
    return { areaMm2: area, source: 'area', errors: [] };
  }
  if (isGiven(cable.outerDiameterMm)) {
    const diameter = cable.outerDiameterMm;
    if (!finite(diameter) || diameter <= 0) return { areaMm2: null, source: null, errors: [`${prefix}: неверный внешний диаметр`] };
    const area = Math.PI * diameter * diameter / 4;
    if (!finite(area)) return { areaMm2: null, source: null, errors: [`${prefix}: неверный внешний диаметр`] };
    return { areaMm2: area, source: 'diameter', errors: [] };
  }
  return { areaMm2: null, source: null, errors: [] };
}

type DimensionState = 'missing' | 'invalid' | 'valid';
const dimensionState = (value: unknown): DimensionState => {
  if (!isGiven(value)) return 'missing';
  return finite(value) && value > 0 ? 'valid' : 'invalid';
};

interface TrayDimensions {
  areaMm2: number | null;
  problem: 'missing' | 'invalid' | null;
}

/** Площадь сечения КНС: явная площадь приоритетнее; для гофры/трубы — круг по диаметру. */
function routeSectionDimensions(route: Route): TrayDimensions {
  const areaState = dimensionState(route.trayAreaMm2);
  if (areaState === 'valid') return { areaMm2: route.trayAreaMm2 as number, problem: null };
  if (areaState === 'invalid') return { areaMm2: null, problem: 'invalid' };
  if (isDiameterRoute(route)) {
    // Для гофры и трубы пользователь задаёт внутренний диаметр (в поле ширины);
    // площадь круга считается автоматически, высота борта не используется.
    const diameterState = dimensionState(route.trayWidthMm);
    if (diameterState === 'invalid') return { areaMm2: null, problem: 'invalid' };
    if (diameterState === 'valid') {
      const diameter = route.trayWidthMm as number;
      const area = Math.PI * diameter * diameter / 4;
      return finite(area) && area > 0 ? { areaMm2: area, problem: null } : { areaMm2: null, problem: 'invalid' };
    }
    return { areaMm2: null, problem: 'missing' };
  }
  const widthState = dimensionState(route.trayWidthMm);
  const heightState = dimensionState(route.trayHeightMm);
  if (widthState === 'invalid' || heightState === 'invalid') return { areaMm2: null, problem: 'invalid' };
  if (widthState === 'valid' && heightState === 'valid') {
    const area = (route.trayWidthMm as number) * (route.trayHeightMm as number);
    return finite(area) && area > 0 ? { areaMm2: area, problem: null } : { areaMm2: null, problem: 'invalid' };
  }
  return { areaMm2: null, problem: 'missing' };
}

const SECTION_PROBLEM_TEXT: Record<'missing' | 'invalid', string> = {
  missing: 'не задано сечение КНС',
  invalid: 'неверное сечение КНС',
};

/** Текстовое обозначение КНС для ведомости: площадь, диаметр, размеры или прочерк. */
export function routeSectionLabel(route: Route): string {
  if (dimensionState(route.trayAreaMm2) === 'valid') return `S=${route.trayAreaMm2} мм²`;
  if (isDiameterRoute(route)) {
    return dimensionState(route.trayWidthMm) === 'valid' ? `Ø${route.trayWidthMm}` : '—';
  }
  if (dimensionState(route.trayWidthMm) === 'valid' && dimensionState(route.trayHeightMm) === 'valid') {
    return `${route.trayWidthMm}×${route.trayHeightMm}`;
  }
  return '—';
}

const validQuantity = (cable: Cable): boolean => Number.isInteger(cable.quantity) && cable.quantity > 0;

/** Длина трассы в метрах: сумма физических длин сегментов; null, если геометрия неполная. */
export function routeLength(project: Project, route: Route): number | null {
  let total = 0;
  for (const segment of route.segments) {
    const length = segmentLength(project, segment);
    if (length === null) return null;
    total += length;
  }
  return total;
}

export interface RouteAngleStats { total: number; angles90: number; angles45: number; other: number }

/**
 * Углы поворота трассы: количество изменений направления и разбивка на 90°/45°.
 * Считаются только стыки соседних сегментов; для коробов это количество углов
 * (без фитингов и креплений).
 */
export function routeAngleStats(route: Route): RouteAngleStats {
  const stats: RouteAngleStats = { total: 0, angles90: 0, angles45: 0, other: 0 };
  const remaining = [...route.segments];
  if (remaining.length < 2) return stats;
  const same = (a: Vertex, b: Vertex) => a.floorId === b.floorId && near(a.x, b.x) && near(a.y, b.y);
  const first = remaining.shift()!;
  const path: { x: number; y: number }[] = [{ x: first.a.x, y: first.a.y }, { x: first.b.x, y: first.b.y }];
  let extended = true;
  while (remaining.length && extended) {
    extended = false;
    for (let index = 0; index < remaining.length; index += 1) {
      const segment = remaining[index];
      const end = path[path.length - 1];
      const endVertex: Vertex = { id: '', floorId: first.a.floorId, x: end.x, y: end.y, height: null };
      if (same(segment.a, endVertex)) {
        path.push({ x: segment.b.x, y: segment.b.y });
        remaining.splice(index, 1);
        extended = true;
        break;
      }
      if (same(segment.b, endVertex)) {
        path.push({ x: segment.a.x, y: segment.a.y });
        remaining.splice(index, 1);
        extended = true;
        break;
      }
    }
  }
  for (let index = 1; index < path.length - 1; index += 1) {
    const ax = path[index].x - path[index - 1].x;
    const ay = path[index].y - path[index - 1].y;
    const bx = path[index + 1].x - path[index].x;
    const by = path[index + 1].y - path[index].y;
    const lengthA = Math.hypot(ax, ay);
    const lengthB = Math.hypot(bx, by);
    if (lengthA < EPS || lengthB < EPS) continue;
    const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (lengthA * lengthB)));
    const angle = Math.acos(cosine) * 180 / Math.PI;
    if (angle < 1) continue;
    stats.total += 1;
    if (Math.abs(angle - 90) <= 10) stats.angles90 += 1;
    else if (Math.abs(angle - 45) <= 10 || Math.abs(angle - 135) <= 10) stats.angles45 += 1;
    else stats.other += 1;
  }
  return stats;
}

export interface DimensionGeometry {
  /** Расстояние по прямой в единицах PDF. */
  units: number | null;
  /** Расстояние по прямой в метрах; null, если масштаб этажа неизвестен. */
  meters: number | null;
  floorId: string | null;
  problem: string | null;
}

/**
 * «Относительный» размер между двумя объектами оборудования: расстояние по прямой,
 * а не длина кабельной трассы. Оборудование должно быть на одном этаже.
 */
export function dimensionGeometry(project: Project, dimension: Dimension): DimensionGeometry {
  const from = project.equipment.find(item => item.id === dimension.fromId);
  const to = project.equipment.find(item => item.id === dimension.toId);
  if (!from || !to) return { units: null, meters: null, floorId: null, problem: 'Оборудование не найдено' };
  if (from.floorId !== to.floorId) return { units: null, meters: null, floorId: from.floorId, problem: 'Оборудование на разных этажах' };
  const units = Math.hypot(to.x - from.x, to.y - from.y);
  if (!finite(units)) return { units: null, meters: null, floorId: from.floorId, problem: 'Неверные координаты оборудования' };
  const floor = project.floors.find(item => item.id === from.floorId);
  const scale = floor?.metersPerUnit;
  const meters = finite(scale) && scale > 0 ? units * scale : null;
  return { units, meters, floorId: from.floorId, problem: null };
}

/** Подпись относительного размера: миллиметры до 1 м, иначе метры; без масштаба — единицы PDF. */
export function dimensionText(distance: DimensionGeometry): string {
  if (distance.meters !== null) {
    return distance.meters < 1
      ? `${Math.round(distance.meters * 1000)} мм`
      : `${distance.meters.toFixed(2).replace('.', ',')} м`;
  }
  return distance.units !== null ? `${Math.round(distance.units)} ед.` : '—';
}

/** Группа сводки по типу КНС: лоток, гофра, труба, кабель-канал или свой тип. */
const ROUTE_GROUP_LABELS: Record<string, string> = {
  tray: 'Лоток', corrugated: 'Гофра', pipe: 'Труба', trunking: 'Кабель-канал',
};
export interface RouteSummaryRow {
  number: string; type: string; group: string; kind: string | null;
  length: number | null; segments: number; angles: RouteAngleStats;
}
export interface RouteSummaryGroup {
  group: string; length: number | null; routes: number; angles: RouteAngleStats;
}
export interface RouteSummaryResult { routes: RouteSummaryRow[]; groups: RouteSummaryGroup[] }

/**
 * Сводка трасс для листа «Схема трасс»: метраж по каждой трассе и по типам КНС
 * (включая суммарную гофру) плюс количество углов у коробов.
 */
export function routeSummary(project: Project): RouteSummaryResult {
  const routes: RouteSummaryRow[] = [];
  const groups: RouteSummaryGroup[] = [];
  for (const route of project.routes) {
    const kind = routeKindOf(route.type);
    const group = kind ? ROUTE_GROUP_LABELS[kind] : (route.type || 'Своя КНС');
    const length = routeLength(project, route);
    const angles = routeAngleStats(route);
    routes.push({ number: route.number, type: route.type, group, kind, length, segments: route.segments.length, angles });
    let totals = groups.find(item => item.group === group);
    if (!totals) { totals = { group, length: 0, routes: 0, angles: { total: 0, angles90: 0, angles45: 0, other: 0 } }; groups.push(totals); }
    totals.routes += 1;
    totals.length = totals.length === null || length === null ? null : totals.length + length;
    totals.angles.total += angles.total;
    totals.angles.angles90 += angles.angles90;
    totals.angles.angles45 += angles.angles45;
    totals.angles.other += angles.other;
  }
  return { routes, groups };
}

export const ROUTE_SUBSYSTEM_LABELS: Record<NonNullable<Route['subsystem']>, string> = {
  horizontal: 'Горизонтальная',
  trunk: 'Магистральная',
  workplace: 'Рабочее место',
};
export const routeSubsystemLabel = (route: Route): string => route.subsystem ? ROUTE_SUBSYSTEM_LABELS[route.subsystem] : 'Не задана';

export interface RouteSectionSuggestion {
  kind: 'diameter' | 'rectangle';
  widthMm: number;
  heightMm: number | null;
  areaMm2: number;
  fillPercent: number;
  label: string;
}

/** Эквивалентный диаметр кабеля по площади сечения (для проверки проходимости). */
const cableEquivalentDiameter = (cable: Cable): number | null => {
  const section = cableSection(cable);
  if (section.areaMm2 === null) return null;
  return Math.sqrt(4 * section.areaMm2 / Math.PI);
};

/**
 * Подбор минимального стандартного сечения КНС по кабелям трассы:
 * заполнение не выше рекомендуемых 40 %, для круглых КНС диаметр не меньше
 * эквивалентного диаметра самого толстого кабеля.
 */
export function suggestRouteSection(project: Project, route: Route): RouteSectionSuggestion | null {
  const fill = trayFill(project);
  const used = Math.max(0, ...fill.segments.filter(row => row.routeId === route.id && row.usedAreaMm2 !== null).map(row => row.usedAreaMm2 as number));
  if (!(used > 0)) return null;
  const routeCables = project.cables.filter(cable => cable.segmentIds.some(id => route.segments.some(segment => segment.id === id)));
  const maxCableDiameter = Math.max(0, ...routeCables.map(cableEquivalentDiameter).filter((value): value is number => value !== null));
  if (isDiameterRoute(route)) {
    for (const diameter of [16, 20, 25, 32, 40, 50, 63, 75, 90, 110]) {
      const area = Math.PI * diameter * diameter / 4;
      const percent = used / area * 100;
      if (diameter >= maxCableDiameter && percent <= TRAY_FILL_RECOMMENDED_PERCENT) {
        return { kind: 'diameter', widthMm: diameter, heightMm: null, areaMm2: area, fillPercent: percent, label: `Ø${diameter} (заполнение ${Math.round(percent)} %)` };
      }
    }
    return null;
  }
  for (const [width, height] of [[50, 50], [100, 50], [100, 80], [150, 50], [150, 80], [200, 50], [200, 80], [300, 50], [300, 100], [400, 100]] as const) {
    const area = width * height;
    const percent = used / area * 100;
    if (percent <= TRAY_FILL_RECOMMENDED_PERCENT) {
      return { kind: 'rectangle', widthMm: width, heightMm: height, areaMm2: area, fillPercent: percent, label: `${width}×${height} (заполнение ${Math.round(percent)} %)` };
    }
  }
  return null;
}

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
    const row = summary.routes.find(item => item.number === route.number && item.type === route.type);
    if (!row) continue;
    const subsystem = routeSubsystemLabel(route);
    const section = routeSectionLabel(route);
    const existing = lines.find(line => line.name === row.group && line.section === section && line.subsystem === subsystem);
    const angles = row.group === 'Кабель-канал' ? row.angles.total : 0;
    if (existing) {
      existing.quantity = existing.quantity === null || row.length === null ? null : existing.quantity + row.length;
      existing.angles += angles;
      existing.routes += 1;
      existing.cost = existing.quantity === null || existing.price === null ? null : existing.quantity * existing.price;
      continue;
    }
    // Сначала ищем позицию по конкретному типу трассы, затем по группе (например, «Гофра»).
    const match = catalog.find(item => item.kind === 'tray' && item.name.trim().toLowerCase() === route.type.trim().toLowerCase())
      ?? catalog.find(item => item.kind === 'tray' && item.name.trim().toLowerCase() === row.group.trim().toLowerCase());
    lines.push({
      name: row.group,
      section,
      subsystem,
      unit: 'м',
      quantity: row.length,
      angles,
      article: match?.article ?? '',
      manufacturer: match?.manufacturer ?? '',
      price: match?.price ?? null,
      cost: row.length === null || !match || match.price === null ? null : row.length * match.price,
      routes: 1,
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

/** Заполнение лотка по каждому сегменту всех трасс проекта. */
export function trayFill(project: Project): TrayFillResult {
  const warnings: string[] = [];
  const segments: SegmentFill[] = [];
  for (const route of project.routes) {
    const section = routeSectionDimensions(route);
    const safeTrayArea = section.problem === null && finite(section.areaMm2) && section.areaMm2 > 0 ? section.areaMm2 : null;
    const trayWidthMm = givenNumber(route.trayWidthMm);
    // Для круглых КНС высота не используется и в ведомость не попадает.
    const trayHeightMm = isDiameterRoute(route) ? null : givenNumber(route.trayHeightMm);
    const routeHasCables = route.segments.some(segment => project.cables.some(cable => cable.segmentIds.includes(segment.id)));
    if (routeHasCables && section.problem) warnings.push(`Трасса ${route.number}: ${SECTION_PROBLEM_TEXT[section.problem]} — заполнение не рассчитано`);
    route.segments.forEach((segment, index) => {
      const label = `${route.number}.${index + 1}`;
      const prefix = `Трасса ${route.number}, сегмент ${label}`;
      const passing = project.cables.filter(cable => cable.segmentIds.includes(segment.id));
      const segmentWarnings: string[] = [];
      let lines = 0;
      let usedAreaMm2: number | null = 0;
      let unknownCables = 0;
      let sectionUnknown = false;
      let quantityUnknown = false;
      const unknownSectionNumbers: string[] = [];
      const unknownQuantityNumbers: string[] = [];
      for (const cable of passing) {
        const section = cableSection(cable);
        const quantityOk = validQuantity(cable);
        if (quantityOk) lines += cable.quantity;
        if (section.areaMm2 === null) {
          sectionUnknown = true;
          unknownSectionNumbers.push(cable.number);
        }
        if (!quantityOk) {
          quantityUnknown = true;
          unknownQuantityNumbers.push(cable.number);
        }
        if (section.areaMm2 === null || !quantityOk) {
          unknownCables += 1;
          continue;
        }
        usedAreaMm2 += section.areaMm2 * cable.quantity;
      }
      if (sectionUnknown) {
        const noun = unknownSectionNumbers.length === 1 ? 'кабеля' : 'кабелей';
        segmentWarnings.push(`${prefix}: не задано сечение ${noun} ${unknownSectionNumbers.join(', ')} — заполнение не рассчитано`);
      }
      if (quantityUnknown) {
        const noun = unknownQuantityNumbers.length === 1 ? 'кабеля' : 'кабелей';
        segmentWarnings.push(`${prefix}: неверное количество ${noun} ${unknownQuantityNumbers.join(', ')} — заполнение не рассчитано`);
      }
      if (sectionUnknown || quantityUnknown) usedAreaMm2 = null;
      const areaMm2 = safeTrayArea;
      let fillPercent: number | null = null;
      let status: TrayFillStatus;
      if (!passing.length) {
        fillPercent = areaMm2 === null ? null : 0;
        status = 'empty';
      } else if (usedAreaMm2 === null || areaMm2 === null) {
        status = 'incomplete';
      } else {
        const rawPercent = usedAreaMm2 / areaMm2 * 100;
        if (!finite(rawPercent)) {
          status = 'incomplete';
        } else {
          fillPercent = rawPercent;
          if (rawPercent > TRAY_FILL_LIMIT_PERCENT + TRAY_FILL_BOUNDARY_EPS) status = 'over';
          else if (rawPercent > TRAY_FILL_RECOMMENDED_PERCENT + TRAY_FILL_BOUNDARY_EPS) status = 'warning';
          else status = 'ok';
          if (status === 'over') segmentWarnings.push(`${prefix}: заполнение ${Math.round(rawPercent)} % — превышен предел ${TRAY_FILL_LIMIT_PERCENT} %`);
          else if (status === 'warning') segmentWarnings.push(`${prefix}: заполнение ${Math.round(rawPercent)} % — больше рекомендуемых ${TRAY_FILL_RECOMMENDED_PERCENT} %`);
        }
      }
      warnings.push(...segmentWarnings);
      segments.push({
        segmentId: segment.id,
        routeId: route.id,
        routeNumber: route.number,
        routeType: route.type,
        trayWidthMm,
        trayHeightMm,
        trayAreaMm2: areaMm2,
        cables: passing.length,
        lines,
        unknownCables,
        usedAreaMm2,
        fillPercent,
        status,
        warnings: [...new Set(segmentWarnings)],
      });
    });
  }
  const known = segments.map(segment => segment.fillPercent).filter((value): value is number => value !== null);
  return {
    segments,
    complete: !segments.some(segment => segment.status === 'incomplete'),
    maxFillPercent: known.length ? Math.max(...known) : null,
    overSegments: segments.filter(segment => segment.status === 'over').length,
    warnings: [...new Set(warnings)],
  };
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
  let fillIndex = 0;
  for (const route of project.routes) {
    for (let index = 0; index < route.segments.length; index += 1) {
      const segmentFill = fill.segments[fillIndex];
      fillIndex += 1;
      trayFillRows.push({
        route: route.number,
        segment: `${route.number}.${index + 1}`,
        routeType: route.type,
        tray: routeSectionLabel(route),
        trayAreaMm2: segmentFill?.trayAreaMm2 ?? null,
        lines: segmentFill?.lines ?? 0,
        areaMm2: segmentFill?.usedAreaMm2 ?? null,
        fillPercent: segmentFill?.fillPercent ?? null,
        status: TRAY_STATUS_LABELS[segmentFill?.status ?? 'incomplete'],
      });
    }
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
    const trayValues = [route.trayWidthMm, route.trayHeightMm, route.trayAreaMm2];
    if (trayValues.some(value => isGiven(value) && (!finite(value) || value <= 0))) errors.push(`Трасса ${route.number}: неверное сечение КНС`);
    for (const segment of route.segments) {
      errors.push(...segmentErrors(project, segment), ...reserveErrors(`Сегмент ${segment.id}`, segment.reservePercent, segment.reserveFixed));
    }
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
