import type { Cable, Project, Route, Segment } from '../model';
import { hasSectionOverride, isDiameterRoute } from '../route-kinds';
import { TRAY_FILL_RECOMMENDED_PERCENT, cableSection, trayFill } from './tray-fill';

/**
 * Подбор минимального стандартного сечения КНС по кабелям трассы и по
 * отдельным сегментам с переопределением.
 *
 * Подбор опирается только на анализируемые сегменты (все без своего сечения —
 * для трассы, ровно один — для сегмента). Если по ним есть неполные данные
 * (неизвестное сечение или количество кабеля), рекомендация не выдаётся:
 * расчёт по части кабелей занизил бы сечение.
 */

export interface RouteSectionSuggestion {
  kind: 'diameter' | 'rectangle';
  widthMm: number;
  heightMm: number | null;
  areaMm2: number;
  fillPercent: number;
  label: string;
}

/** Количество кабеля задано корректно (как в tray-fill: целое положительное). */
const validQuantity = (cable: Cable): boolean => Number.isInteger(cable.quantity) && cable.quantity > 0;

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

interface SegmentAnalysis {
  usedAreaMm2: number;
  /** Эквивалентный диаметр самого толстого кабеля на анализируемых сегментах. */
  thickestCableDiameterMm: number;
}

/**
 * Занятая площадь и самый толстый кабель только по выбранным сегментам трассы.
 * null — данных недостаточно: неполная fill-строка, неизвестное сечение или
 * количество кабеля. Кабели соседних сегментов и других трасс не учитываются.
 */
function analyseSegments(project: Project, route: Route, predicate: (segment: Segment) => boolean): SegmentAnalysis | null {
  const segments = route.segments.filter(predicate);
  if (!segments.length) return null;
  const segmentIds = new Set(segments.map(segment => segment.id));
  const fill = trayFill(project);
  const rows = new Map(
    fill.segments
      .filter(row => row.routeId === route.id && segmentIds.has(row.segmentId))
      .map(row => [row.segmentId, row]),
  );
  let usedAreaMm2 = 0;
  for (const segment of segments) {
    const row = rows.get(segment.id);
    // Нет строки — сегмент не рассчитан (например, трасса не входит в проект).
    if (!row) return null;
    // Неполнота данных о кабелях. Статус 'incomplete' сам по себе не отказ: он бывает
    // и когда не задано текущее сечение КНС, а занятая площадь при этом известна —
    // именно для такого случая подбор и нужен.
    if (row.usedAreaMm2 === null || row.unknownCables > 0) return null;
    usedAreaMm2 = Math.max(usedAreaMm2, row.usedAreaMm2);
  }
  const cables = project.cables.filter(cable => cable.segmentIds.some(id => segmentIds.has(id)));
  let thickestCableDiameterMm = 0;
  for (const cable of cables) {
    const section = cableSection(cable);
    if (section.areaMm2 === null || !validQuantity(cable)) return null;
    const diameter = Math.sqrt(4 * section.areaMm2 / Math.PI);
    thickestCableDiameterMm = Math.max(thickestCableDiameterMm, diameter);
  }
  return { usedAreaMm2, thickestCableDiameterMm };
}

/**
 * Подбор минимального стандартного сечения КНС по кабелям трассы:
 * заполнение не выше рекомендуемых 40 %, для круглых КНС диаметр не меньше
 * эквивалентного диаметра самого толстого кабеля на тех же сегментах.
 * Учитываются только сегменты без собственного сечения: сегменты с переопределением
 * подбираются отдельно (`suggestSegmentSection`), иначе предложение их не изменит.
 * Неполные данные по этим сегментам — null, а не рекомендация по части кабелей.
 */
export function suggestRouteSection(project: Project, route: Route): RouteSectionSuggestion | null {
  const analysis = analyseSegments(project, route, segment => !hasSectionOverride(segment));
  if (!analysis || !(analysis.usedAreaMm2 > 0)) return null;
  return pickStandardSection(analysis.usedAreaMm2, route, analysis.thickestCableDiameterMm);
}

/**
 * Подбор стандартного сечения для одного сегмента с переопределением:
 * по кабелям, проходящим через этот сегмент, и с ограничением по их диаметру.
 * Неполные данные по сегменту — null.
 */
export function suggestSegmentSection(project: Project, route: Route, segment: Segment): RouteSectionSuggestion | null {
  const analysis = analyseSegments(project, route, item => item.id === segment.id);
  if (!analysis || !(analysis.usedAreaMm2 > 0)) return null;
  return pickStandardSection(analysis.usedAreaMm2, route, analysis.thickestCableDiameterMm);
}
