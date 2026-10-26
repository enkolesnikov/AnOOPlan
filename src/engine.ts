/**
 * Публичный фасад расчётного движка. Реализация разложена по `src/engine/*`:
 * геометрия, заполнение лотка, трассы, подбор сечения, спецификации.
 * Публичный API прежний — все функции, типы, интерфейсы и константы доступны
 * по тем же именам из `./engine`.
 *
 * Блоки помечены `@public`: это публичный API, и knip не должен сообщать о
 * реэкспорте как о неиспользуемом, если символ нужен только внутри движка.
 */

// Геометрия и расчёт кабелей.
/** @public */
export {
  calculateCable,
  chainEnds,
  dimensionGeometry,
  dimensionText,
  findRoute,
  routeAngleStats,
  routeLength,
  segmentLength,
} from './engine/geometry';
/** @public */
export type { CableCalculation, DimensionGeometry, RouteAngleStats } from './engine/geometry';

// Сечения КНС и заполнение лотка.
/** @public */
export {
  TRAY_FILL_LIMIT_PERCENT,
  TRAY_FILL_RECOMMENDED_PERCENT,
  cableSection,
  trayFill,
} from './engine/tray-fill';
/** @public */
export type { CableSection, SegmentFill, TrayFillResult, TrayFillStatus } from './engine/tray-fill';

// Трассы: метраж, углы, сечения, сводка по типам КНС.
/** @public */
export {
  ROUTE_SUBSYSTEM_LABELS,
  routeSectionLengths,
  routeSectionsText,
  routeSubsystemLabel,
  routeSummary,
} from './engine/routes';
/** @public */
export type { RouteSectionLength, RouteSummaryGroup, RouteSummaryResult, RouteSummaryRow } from './engine/routes';

// Подбор стандартного сечения.
/** @public */
export { suggestRouteSection, suggestSegmentSection } from './engine/suggest';
/** @public */
export type { RouteSectionSuggestion } from './engine/suggest';

// Спецификации и валидация проекта.
/** @public */
export { domainWarnings, specificationKnS, specifications, validateProject } from './engine/specification';
/** @public */
export type { KnSLine, KnSSpecification, TrayFillRow } from './engine/specification';
