import type { Cable, Point, Route, Segment, Vertex } from './model';
import { createUuid as uid } from './compat';

/** Точка на сегменте: параметр 0..1 с отступом от концов, чтобы не плодить нулевые сегменты. */
export function segmentSplitPoint(segment: Segment, point: Point): { vertex: Vertex; t: number } | null {
  if (segment.a.floorId !== segment.b.floorId) return null;
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-9) return null;
  const raw = ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / lengthSquared;
  const t = Math.min(0.9, Math.max(0.1, raw));
  const height = segment.a.height !== null && segment.b.height !== null
    ? segment.a.height + (segment.b.height - segment.a.height) * t
    : null;
  return {
    t,
    vertex: { id: uid(), floorId: segment.a.floorId, x: segment.a.x + dx * t, y: segment.a.y + dy * t, height },
  };
}

/** Делит сегмент на два с сохранением размеров КНС и запасов. */
export function splitSegment(segment: Segment, point: Point): { vertex: Vertex; first: Segment; second: Segment } | null {
  const split = segmentSplitPoint(segment, point);
  if (!split) return null;
  const { vertex } = split;
  const base = { mode: segment.mode, reservePercent: segment.reservePercent, reserveFixed: segment.reserveFixed, trayWidthMm: segment.trayWidthMm, trayHeightMm: segment.trayHeightMm, trayAreaMm2: segment.trayAreaMm2 };
  return {
    vertex,
    first: { ...base, id: uid(), a: segment.a, b: vertex },
    second: { ...base, id: uid(), a: vertex, b: segment.b },
  };
}

/** Заменяет сегмент в цепочке кабеля на два, сохраняя порядок обхода. */
export function replaceCableSegment(cable: Cable, segmentId: string, firstId: string, secondId: string): Cable {
  if (!cable.segmentIds.includes(segmentId)) return cable;
  return { ...cable, segmentIds: cable.segmentIds.flatMap(id => id === segmentId ? [firstId, secondId] : [id]) };
}


export interface DeleteVertexResult {
  route: Route;
  oldSegmentIds: [string, string];
  newSegmentId: string;
  /** true — объединяемые сегменты имели разные размеры/запасы, взяты параметры первого. */
  mergedProperties: boolean;
  warning?: string;
}

/**
 * Удаляет внутреннюю вершину трассы: два соседних сегмента сливаются в один.
 * Концевые вершины (один сегмент) не удаляются — иначе трасса теряет сегмент.
 */
export function deleteVertex(route: Route, vertexId: string): DeleteVertexResult | null {
  const touching = route.segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.a.id === vertexId || segment.b.id === vertexId);
  if (touching.length !== 2) return null;
  const [first, second] = touching;
  if (Math.abs(first.index - second.index) !== 1) return null;
  const firstOuter = first.segment.a.id === vertexId ? first.segment.b : first.segment.a;
  const secondOuter = second.segment.a.id === vertexId ? second.segment.b : second.segment.a;
  if (firstOuter.id === secondOuter.id || (firstOuter.floorId === secondOuter.floorId && firstOuter.x === secondOuter.x && firstOuter.y === secondOuter.y)) return null;
  const signature = (segment: Segment) => JSON.stringify([segment.mode, segment.reservePercent, segment.reserveFixed, segment.trayWidthMm, segment.trayHeightMm, segment.trayAreaMm2]);
  const mergedProperties = signature(first.segment) !== signature(second.segment);
  const newSegmentId = uid();
  const merged: Segment = {
    ...first.segment,
    id: newSegmentId,
    a: firstOuter,
    b: secondOuter,
  };
  const start = Math.min(first.index, second.index);
  const segments = [...route.segments];
  segments.splice(start, 2, merged);
  return {
    route: { ...route, segments },
    oldSegmentIds: [first.segment.id, second.segment.id],
    newSegmentId,
    mergedProperties,
    warning: mergedProperties ? 'Сегменты имели разные размеры/запасы — у объединённого взяты параметры первого.' : undefined,
  };
}

/** Меняет направление трассы: порядок сегментов и концы a/b. */
export function reverseRoute(route: Route): Route {
  return {
    ...route,
    segments: [...route.segments].reverse().map(segment => ({ ...segment, a: segment.b, b: segment.a })),
  };
}

/** Цепочка кабеля при реверсе трассы идёт в обратном порядке. */
export function reverseCableRoute(cable: Cable, routeSegmentIds: string[]): Cable {
  if (!cable.segmentIds.some(id => routeSegmentIds.includes(id))) return cable;
  return { ...cable, segmentIds: [...cable.segmentIds].reverse() };
}
