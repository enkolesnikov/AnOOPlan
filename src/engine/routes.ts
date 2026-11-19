import type { Project, Route, Vertex } from '../model';
import { hasSectionOverride, routeKindOf, segmentSectionLabel } from '../route-kinds';
import { addRouteAngle, planNodeKey, planarAngle, routeAngleStats, routeChain, routeLength, segmentLength } from './geometry';
import type { RouteAngleStats } from './geometry';

/**
 * Трассы: физический метраж, углы поворота, метраж по сечениям и сводка
 * по типам КНС. Вынесено из `src/engine.ts` без изменения поведения.
 */

/** Группа сводки по типу КНС: лоток, гофра, труба, кабель-канал или свой тип. */
const ROUTE_GROUP_LABELS: Record<string, string> = {
  tray: 'Лоток', corrugated: 'Гофра', pipe: 'Труба', trunking: 'Кабель-канал',
};
export interface RouteSectionLength {
  /** Эффективное сечение участков: «100×50», «Ø20» или «S=500 мм²». */
  section: string;
  length: number | null;
  segments: number;
  /** Хотя бы один сегмент переопределяет сечение трассы. */
  overridden: boolean;
}
export interface RouteSummaryRow {
  id: string; number: string; type: string; group: string; kind: string | null;
  length: number | null; segments: number; angles: RouteAngleStats;
  /** Метраж по эффективным сечениям: в одной трассе могут быть разные лотки/трубы. */
  sections: RouteSectionLength[];
}
export interface RouteSummaryGroup {
  group: string; length: number | null; routes: number; angles: RouteAngleStats;
}
export interface RouteSummaryResult { routes: RouteSummaryRow[]; groups: RouteSummaryGroup[] }

/** Конец трассы на узле: нужен для счёта углов на стыках трасс одного типа КНС. */
interface JunctionEnd {
  row: RouteSummaryRow;
  route: Route;
  vertex: Vertex;
  /** Единичное направление от узла вглубь трассы. */
  dir: { x: number; y: number };
  /** В узле начинается сегмент трассы (его a), а не заканчивается. */
  startsAtNode: boolean;
}

/** Узел стыка: этаж входит в ключ — трассы разных этажей в одной точке не соединяются. */
const junctionNodeKey = (vertex: Vertex): string => `${vertex.floorId}|${planNodeKey(vertex.x, vertex.y)}`;

/** Метраж трассы по эффективным сечениям сегментов (переопределение важнее размера трассы). */
export function routeSectionLengths(project: Project, route: Route): RouteSectionLength[] {
  const rows: RouteSectionLength[] = [];
  for (const segment of route.segments) {
    const section = segmentSectionLabel(route, segment);
    const length = segmentLength(project, segment);
    let row = rows.find(item => item.section === section);
    if (!row) {
      row = { section, length: 0, segments: 0, overridden: false };
      rows.push(row);
    }
    row.segments += 1;
    if (hasSectionOverride(segment)) row.overridden = true;
    row.length = row.length === null || length === null ? null : row.length + length;
  }
  return rows;
}

/** Текст сечений трассы для схемы трасс: «100×50 — 12,4 м; Ø25 — 3,1 м». */
export function routeSectionsText(sections: RouteSectionLength[], format: (value: number | null) => string): string {
  if (!sections.length) return '—';
  return sections.map(item => `${item.section} — ${format(item.length)} м`).join('; ');
}

/**
 * Сводка трасс для листа «Схема трасс»: метраж по каждой трассе и по типам КНС
 * (включая суммарную гофру) плюс количество углов у коробов и метраж по сечениям.
 * Углы на стыке двух трасс одного типа КНС считаются один раз: сумма по трассам
 * совпадает с итогом группы. Угол относится к трассе, чей сегмент начинается
 * в узле; при равенстве — по id/number.
 */
export function routeSummary(project: Project): RouteSummaryResult {
  const routes: RouteSummaryRow[] = [];
  const junctions = new Map<string, JunctionEnd[]>();
  for (const route of project.routes) {
    const kind = routeKindOf(route.type);
    const group = kind ? ROUTE_GROUP_LABELS[kind] : (route.type || 'Своя КНС');
    const length = routeLength(project, route);
    const angles = routeAngleStats(route);
    const row: RouteSummaryRow = {
      id: route.id, number: route.number, type: route.type, group, kind,
      length, segments: route.segments.length, angles, sections: routeSectionLengths(project, route),
    };
    routes.push(row);

    const chain = routeChain(route);
    if (!chain) continue;
    const lastStep = chain.steps[chain.steps.length - 1];
    const ends = [
      { vertex: chain.start.vertex, dir: chain.start.dir, startsAtNode: !chain.steps[0].reversed },
      { vertex: chain.end.vertex, dir: chain.end.dir, startsAtNode: lastStep.reversed },
    ];
    for (const end of ends) {
      if (!end.dir) continue;
      const key = `${group}\u0000${junctionNodeKey(end.vertex)}`;
      const entry: JunctionEnd = { row, route, vertex: end.vertex, dir: end.dir, startsAtNode: end.startsAtNode };
      const list = junctions.get(key);
      if (list) list.push(entry);
      else junctions.set(key, [entry]);
    }
  }

  for (const entries of junctions.values()) {
    const seen = new Set<string>();
    for (let first = 0; first < entries.length; first += 1) {
      for (let second = first + 1; second < entries.length; second += 1) {
        const a = entries[first];
        const b = entries[second];
        if (a.route.id === b.route.id) continue;
        const pair = a.route.id < b.route.id ? `${a.route.id}|${b.route.id}` : `${b.route.id}|${a.route.id}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        // Идём по A к узлу (-dirA), затем по B от узла (dirB).
        const angle = planarAngle(-a.dir.x, -a.dir.y, b.dir.x, b.dir.y);
        if (angle === null) continue;
        const target = [a, b].sort((left, right) => {
          if (left.startsAtNode !== right.startsAtNode) return left.startsAtNode ? -1 : 1;
          if (left.row.id !== right.row.id) return left.row.id < right.row.id ? -1 : 1;
          return left.row.number < right.row.number ? -1 : left.row.number > right.row.number ? 1 : 0;
        })[0];
        addRouteAngle(target.row.angles, angle);
      }
    }
  }

  const groups: RouteSummaryGroup[] = [];
  for (const row of routes) {
    let totals = groups.find(item => item.group === row.group);
    if (!totals) { totals = { group: row.group, length: 0, routes: 0, angles: { total: 0, angles90: 0, angles45: 0, other: 0 } }; groups.push(totals); }
    totals.routes += 1;
    totals.length = totals.length === null || row.length === null ? null : totals.length + row.length;
    totals.angles.total += row.angles.total;
    totals.angles.angles90 += row.angles.angles90;
    totals.angles.angles45 += row.angles.angles45;
    totals.angles.other += row.angles.other;
  }
  return { routes, groups };
}

export const ROUTE_SUBSYSTEM_LABELS: Record<NonNullable<Route['subsystem']>, string> = {
  horizontal: 'Горизонтальная',
  trunk: 'Магистральная',
  workplace: 'Рабочее место',
};
export const routeSubsystemLabel = (route: Route): string => route.subsystem ? ROUTE_SUBSYSTEM_LABELS[route.subsystem] : 'Не задана';
