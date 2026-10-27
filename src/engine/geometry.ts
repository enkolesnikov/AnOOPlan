import type { Cable, Dimension, Equipment, Project, Route, Segment, Vertex } from '../model';

/**
 * Геометрия и расчёт кабелей: длины сегментов, поиск маршрута по трассам,
 * запасы, относительные размеры. Вынесено из `src/engine.ts` без изменения
 * поведения — только импорты и экспорт внутренних helper'ов.
 */

export const EPS = 1e-6;
export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
export const near = (a: number, b: number) => finite(a) && finite(b) && Math.abs(a - b) <= EPS;
const samePlan = (a: Pick<Vertex, 'floorId' | 'x' | 'y'>, b: Pick<Vertex, 'floorId' | 'x' | 'y'>) =>
  a.floorId === b.floorId && near(a.x, b.x) && near(a.y, b.y);
const sameVertex = (a: Vertex, b: Vertex) => samePlan(a, b) && finite(a.height) && finite(b.height) && near(a.height, b.height);

export function segmentErrors(project: Project, segment: Segment): string[] {
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

export function segmentIndex(project: Project) {
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
    const start = reverse ? chain[0].b : chain[0].a;
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

  const key = (floorId: string, x: number, y: number, height: number | null) => `${floorId}|${x.toFixed(3)}|${y.toFixed(3)}|${height === null ? '?' : height.toFixed(3)}`;
  const adjacency = new Map<string, { segmentId: string; other: string; weight: number }[]>();
  const positions = new Map<string, { floorId: string; x: number; y: number }>();
  const weightOf = (segment: Segment) => { const length = segmentLength(project, segment); return length === null ? null : Math.max(length, 1e-6); };

  for (const route of project.routes) {
    for (const segment of route.segments) {
      const ka = key(segment.a.floorId, segment.a.x, segment.a.y, segment.a.height);
      const kb = key(segment.b.floorId, segment.b.x, segment.b.y, segment.b.height);
      const weight = weightOf(segment);
      if (weight === null) continue;
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

export function reserveErrors(owner: string, percent: number, fixed: number): string[] {
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
