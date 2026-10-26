import type { Project, Route } from '../model';
import { hasSectionOverride, routeKindOf, segmentSectionLabel } from '../route-kinds';
import { routeAngleStats, routeLength, segmentLength } from './geometry';
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
 */
export function routeSummary(project: Project): RouteSummaryResult {
  const routes: RouteSummaryRow[] = [];
  const groups: RouteSummaryGroup[] = [];
  for (const route of project.routes) {
    const kind = routeKindOf(route.type);
    const group = kind ? ROUTE_GROUP_LABELS[kind] : (route.type || 'Своя КНС');
    const length = routeLength(project, route);
    const angles = routeAngleStats(route);
    routes.push({
      id: route.id, number: route.number, type: route.type, group, kind,
      length, segments: route.segments.length, angles, sections: routeSectionLengths(project, route),
    });
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
