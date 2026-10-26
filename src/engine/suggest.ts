import type { Cable, Project, Route, Segment } from '../model';
import { hasSectionOverride, isDiameterRoute } from '../route-kinds';
import { TRAY_FILL_RECOMMENDED_PERCENT, cableSection, trayFill } from './tray-fill';

/**
 * Подбор минимального стандартного сечения КНС по кабелям трассы и по
 * отдельным сегментам с переопределением. Вынесено из `src/engine.ts` без
 * изменения поведения.
 */

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

/** Минимальное стандартное сечение под заданную занятую площадь и самый толстый кабель. */
function pickStandardSection(used: number, route: Route, maxCableDiameter: number): RouteSectionSuggestion | null {
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

/** Максимальная занятая площадь по сегментам с заданным фильтром; null — кабелей без сечения нет. */
function usedAreaOf(project: Project, route: Route, predicate: (segment: Segment) => boolean): number {
  const fill = trayFill(project);
  const relevant = new Set(route.segments.filter(predicate).map(segment => segment.id));
  const used = fill.segments
    .filter(row => row.routeId === route.id && relevant.has(row.segmentId) && row.usedAreaMm2 !== null)
    .map(row => row.usedAreaMm2 as number);
  return used.length ? Math.max(...used) : 0;
}

/** Самый толстый кабель по эквивалентному диаметру среди кабелей трассы. */
function thickestCableDiameter(project: Project, route: Route): number {
  const segmentIds = new Set(route.segments.map(segment => segment.id));
  const routeCables = project.cables.filter(cable => cable.segmentIds.some(id => segmentIds.has(id)));
  return Math.max(0, ...routeCables.map(cableEquivalentDiameter).filter((value): value is number => value !== null));
}

/**
 * Подбор минимального стандартного сечения КНС по кабелям трассы:
 * заполнение не выше рекомендуемых 40 %, для круглых КНС диаметр не меньше
 * эквивалентного диаметра самого толстого кабеля.
 * Учитываются только сегменты без собственного сечения: сегменты с переопределением
 * подбираются отдельно (`suggestSegmentSection`), иначе предложение их не изменит.
 */
export function suggestRouteSection(project: Project, route: Route): RouteSectionSuggestion | null {
  const used = usedAreaOf(project, route, segment => !hasSectionOverride(segment));
  if (!(used > 0)) return null;
  return pickStandardSection(used, route, thickestCableDiameter(project, route));
}

/** Подбор стандартного сечения для одного сегмента с переопределением. */
export function suggestSegmentSection(project: Project, route: Route, segment: Segment): RouteSectionSuggestion | null {
  const used = usedAreaOf(project, route, item => item.id === segment.id);
  if (!(used > 0)) return null;
  return pickStandardSection(used, route, thickestCableDiameter(project, route));
}
