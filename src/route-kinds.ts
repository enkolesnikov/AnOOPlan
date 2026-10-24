import type { Route } from './model';

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

/** Человекочитаемое обозначение сечения КНС для подписей и ведомостей. */
export function routeSectionLabel(route: Route): string {
  if (typeof route.trayAreaMm2 === 'number' && Number.isFinite(route.trayAreaMm2) && route.trayAreaMm2 > 0) {
    return `S=${route.trayAreaMm2} мм²`;
  }
  const width = route.trayWidthMm;
  const height = route.trayHeightMm;
  if (isDiameterRoute(route)) {
    return typeof width === 'number' && Number.isFinite(width) && width > 0 ? `Ø${width}` : '—';
  }
  if (typeof width === 'number' && Number.isFinite(width) && width > 0 && typeof height === 'number' && Number.isFinite(height) && height > 0) {
    return `${width}×${height}`;
  }
  return '—';
}
