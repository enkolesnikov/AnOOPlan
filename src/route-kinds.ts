import type { Route, Segment } from './model';

/**
 * Типы кабеленесущих систем (КНС): лоток, гофра, труба, кабель-канал.
 *
 * Базовые типы взяты из практики проектирования СКС (в nanoCAD BIM СКС — лотки, трубы,
 * короба; гофра добавлена как отдельный распространённый тип). Тип задаёт цвет по умолчанию,
 * способ расчёта сечения (прямоугольное Ш×В или круглое по диаметру) и подписи в интерфейсе.
 * `Route.type` остаётся строкой — старые проекты и свои названия открываются без миграций.
 */

export type RouteKindId = 'tray' | 'corrugated' | 'pipe' | 'trunking';

export interface RouteKindPreset {
  id: RouteKindId;
  label: string;
  /** Каноническое значение Route.type. */
  type: string;
  /** Цвет по умолчанию на плане, в списке и PDF. */
  color: string;
  /** Как считается сечение: прямоугольник (Ш×В) или круг (диаметр). */
  section: 'rectangle' | 'diameter';
}

export const ROUTE_KIND_PRESETS: readonly RouteKindPreset[] = [
  { id: 'tray', label: 'Лоток', type: 'Лоток', color: '#008e94', section: 'rectangle' },
  { id: 'corrugated', label: 'Гофра', type: 'Гофра', color: '#e78c22', section: 'diameter' },
  { id: 'pipe', label: 'Труба', type: 'Труба', color: '#2f6fda', section: 'diameter' },
  { id: 'trunking', label: 'Кабель-канал', type: 'Кабель-канал', color: '#2f9e63', section: 'rectangle' },
];

/** Цвет для своих типов, которых нет среди пресетов (например, «Стояк»). */
export const ROUTE_DEFAULT_COLOR = '#6b7f8c';

const TYPE_PATTERNS: readonly { id: RouteKindId; pattern: RegExp }[] = [
  { id: 'tray', pattern: /лоток|лотк/ },
  { id: 'corrugated', pattern: /гофр/ },
  { id: 'pipe', pattern: /труб/ },
  { id: 'trunking', pattern: /кабел\S*[\s-]*канал|короб/ },
];

const normalizedType = (type: string): string => (typeof type === 'string' ? type.trim().toLowerCase() : '');

/** Вид КНС по свободному названию типа; null — свой тип. */
export function routeKindOf(type: string): RouteKindId | null {
  const value = normalizedType(type);
  if (!value) return null;
  return TYPE_PATTERNS.find(item => item.pattern.test(value))?.id ?? null;
}

export function routeKindPreset(type: string): RouteKindPreset | null {
  const id = routeKindOf(type);
  return id ? ROUTE_KIND_PRESETS.find(preset => preset.id === id) ?? null : null;
}

export function isDiameterRoute(route: Pick<Route, 'type'>): boolean {
  return routeKindPreset(route.type)?.section === 'diameter';
}

export function defaultRouteColor(type: string): string {
  return routeKindPreset(type)?.color ?? ROUTE_DEFAULT_COLOR;
}

/**
 * Нормализация цвета трассы: #rgb → #rrggbb в нижнем регистре; мусор — null.
 * Пустое значение означает «цвет по умолчанию для типа», а не чёрный.
 */
export function normalizeRouteColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : null;
}

/** Цвет трассы: сохранённый валидный или по умолчанию для её типа. */
export function routeColor(route: Pick<Route, 'type' | 'color'>): string {
  return normalizeRouteColor(route.color) ?? defaultRouteColor(route.type);
}

/** Поля сечения КНС: одинаковый набор у трассы и у сегмента. */
export interface SectionDimensions {
  trayWidthMm?: number | null;
  trayHeightMm?: number | null;
  trayAreaMm2?: number | null;
}

/** Поля сечения в порядке приоритета: площадь, затем ширина/диаметр и высота. */
export const SECTION_DIM_KEYS = ['trayAreaMm2', 'trayWidthMm', 'trayHeightMm'] as const;

const isGiven = (value: unknown): boolean => value !== undefined && value !== null;

/** Есть ли у сегмента собственное сечение (хотя бы одно заданное поле). */
export function hasSectionOverride(segment: SectionDimensions): boolean {
  return SECTION_DIM_KEYS.some(key => isGiven(segment[key]));
}

/**
 * Эффективные размеры участка КНС: заданное поле сегмента переопределяет поле трассы,
 * незаданное — наследуется от трассы (поле в поле, а не «сечение целиком»).
 */
export function effectiveSectionDims(route: SectionDimensions, segment?: SectionDimensions): SectionDimensions {
  const dims: SectionDimensions = {};
  for (const key of SECTION_DIM_KEYS) {
    const value = segment && isGiven(segment[key]) ? segment[key] : route[key];
    if (isGiven(value)) dims[key] = value;
  }
  return dims;
}

/** Человекочитаемое обозначение сечения КНС для подписей и ведомостей. */
export function sectionLabel(type: string, dims: SectionDimensions): string {
  if (typeof dims.trayAreaMm2 === 'number' && Number.isFinite(dims.trayAreaMm2) && dims.trayAreaMm2 > 0) {
    return `S=${dims.trayAreaMm2} мм²`;
  }
  const width = dims.trayWidthMm;
  const height = dims.trayHeightMm;
  if (isDiameterRoute({ type })) {
    return typeof width === 'number' && Number.isFinite(width) && width > 0 ? `Ø${width}` : '—';
  }
  if (typeof width === 'number' && Number.isFinite(width) && width > 0 && typeof height === 'number' && Number.isFinite(height) && height > 0) {
    return `${width}×${height}`;
  }
  return '—';
}

/** Сечение трассы (без учёта переопределений сегментов). */
export function routeSectionLabel(route: Route): string {
  return sectionLabel(route.type, route);
}

/** Эффективное сечение сегмента: своё, если задано, иначе сечение трассы. */
export function segmentSectionLabel(route: Route, segment: Segment): string {
  return sectionLabel(route.type, effectiveSectionDims(route, segment));
}
