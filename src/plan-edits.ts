import type { Cable, Point, Segment, Vertex } from './model';
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
