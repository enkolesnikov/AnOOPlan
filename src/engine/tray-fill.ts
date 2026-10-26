import type { Cable, Project, Route, Segment } from '../model';
import {
  effectiveSectionDims,
  hasSectionOverride,
  isDiameterRoute,
  segmentSectionLabel,
} from '../route-kinds';
import { finite } from './geometry';

/**
 * Сечения КНС и заполнение лотка: площадь внешнего сечения кабеля, размеры
 * участка и расчёт заполнения. Вынесено из `src/engine.ts` без изменения
 * поведения — только импорты и экспорт внутренних helper'ов.
 */

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
  /** Сегмент переопределяет сечение трассы. */
  overridden: boolean;
  /** Эффективное сечение для ведомости: «100×50», «Ø20» или «S=500 мм²». */
  sectionLabel: string;
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

export const isGiven = (value: unknown): boolean => value !== undefined && value !== null;
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

/**
 * Площадь сечения КНС участка: явная площадь приоритетнее; для гофры/трубы — круг по диаметру.
 * Без сегмента считаются размеры трассы, с сегментом — его переопределение (поле в поле).
 */
function routeSectionDimensions(route: Route, segment?: Segment): TrayDimensions {
  const dims = effectiveSectionDims(route, segment);
  const areaState = dimensionState(dims.trayAreaMm2);
  if (areaState === 'valid') return { areaMm2: dims.trayAreaMm2 as number, problem: null };
  if (areaState === 'invalid') return { areaMm2: null, problem: 'invalid' };
  if (isDiameterRoute(route)) {
    // Для гофры и трубы пользователь задаёт внутренний диаметр (в поле ширины);
    // площадь круга считается автоматически, высота борта не используется.
    const diameterState = dimensionState(dims.trayWidthMm);
    if (diameterState === 'invalid') return { areaMm2: null, problem: 'invalid' };
    if (diameterState === 'valid') {
      const diameter = dims.trayWidthMm as number;
      const area = Math.PI * diameter * diameter / 4;
      return finite(area) && area > 0 ? { areaMm2: area, problem: null } : { areaMm2: null, problem: 'invalid' };
    }
    return { areaMm2: null, problem: 'missing' };
  }
  const widthState = dimensionState(dims.trayWidthMm);
  const heightState = dimensionState(dims.trayHeightMm);
  if (widthState === 'invalid' || heightState === 'invalid') return { areaMm2: null, problem: 'invalid' };
  if (widthState === 'valid' && heightState === 'valid') {
    const area = (dims.trayWidthMm as number) * (dims.trayHeightMm as number);
    return finite(area) && area > 0 ? { areaMm2: area, problem: null } : { areaMm2: null, problem: 'invalid' };
  }
  return { areaMm2: null, problem: 'missing' };
}

/** Заданное, но некорректное значение размера (0, отрицательное, NaN/Infinity). */
export const invalidGivenDimension = (value: unknown): boolean => isGiven(value) && (!finite(value) || value <= 0);

const SECTION_PROBLEM_TEXT: Record<'missing' | 'invalid', string> = {
  missing: 'не задано сечение КНС',
  invalid: 'неверное сечение КНС',
};

const validQuantity = (cable: Cable): boolean => Number.isInteger(cable.quantity) && cable.quantity > 0;

/** Заполнение лотка по каждому сегменту всех трасс проекта. */
export function trayFill(project: Project): TrayFillResult {
  const warnings: string[] = [];
  const segments: SegmentFill[] = [];
  for (const route of project.routes) {
    const routeSection = routeSectionDimensions(route);
    // Сегменты без своего сечения используют размер трассы: если он не задан,
    // предупреждение относится к трассе, а не повторяется на каждом сегменте.
    const inheritedCableSegments = route.segments.filter(segment => !hasSectionOverride(segment)
      && project.cables.some(cable => cable.segmentIds.includes(segment.id)));
    if (routeSection.problem && inheritedCableSegments.length) {
      warnings.push(`Трасса ${route.number}: ${SECTION_PROBLEM_TEXT[routeSection.problem]} — заполнение не рассчитано`);
    }
    route.segments.forEach((segment, index) => {
      const label = `${route.number}.${index + 1}`;
      const prefix = `Трасса ${route.number}, сегмент ${label}`;
      const section = routeSectionDimensions(route, segment);
      const overridden = hasSectionOverride(segment);
      const dims = effectiveSectionDims(route, segment);
      const safeTrayArea = section.problem === null && finite(section.areaMm2) && section.areaMm2 > 0 ? section.areaMm2 : null;
      const trayWidthMm = givenNumber(dims.trayWidthMm);
      // Для круглых КНС высота не используется и в ведомость не попадает.
      const trayHeightMm = isDiameterRoute(route) ? null : givenNumber(dims.trayHeightMm);
      const passing = project.cables.filter(cable => cable.segmentIds.includes(segment.id));
      const segmentWarnings: string[] = [];
      // Ошибка в собственном сечении сегмента не должна теряться за предупреждением трассы.
      if (section.problem && (overridden || !inheritedCableSegments.length) && passing.length) {
        segmentWarnings.push(`${prefix}: ${SECTION_PROBLEM_TEXT[section.problem]} — заполнение не рассчитано`);
      }
      let lines = 0;
      let usedAreaMm2: number | null = 0;
      let unknownCables = 0;
      let sectionUnknown = false;
      let quantityUnknown = false;
      const unknownSectionNumbers: string[] = [];
      const unknownQuantityNumbers: string[] = [];
      for (const cable of passing) {
        const cableArea = cableSection(cable);
        const quantityOk = validQuantity(cable);
        if (quantityOk) lines += cable.quantity;
        if (cableArea.areaMm2 === null) {
          sectionUnknown = true;
          unknownSectionNumbers.push(cable.number);
        }
        if (!quantityOk) {
          quantityUnknown = true;
          unknownQuantityNumbers.push(cable.number);
        }
        if (cableArea.areaMm2 === null || !quantityOk) {
          unknownCables += 1;
          continue;
        }
        usedAreaMm2 += cableArea.areaMm2 * cable.quantity;
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
        overridden,
        sectionLabel: segmentSectionLabel(route, segment),
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
