import type { Project } from '../src/model.js';
import { normalizeEquipmentColor } from '../src/equipment-icons.js';
import { isCatalogDate } from '../src/estimate.js';
import { normalizeRouteColor } from '../src/route-kinds.js';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const fail = (message: string): never => { throw new ApiError(422, message); };
const object = (value: unknown, at: string): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${at}: ожидается объект`);
  return value as Record<string, any>;
};
const text = (value: unknown, at: string, required = false): void => {
  if (typeof value !== 'string' || (required && !value.trim()) || (typeof value === 'string' && value.length > 10000)) fail(`${at}: некорректная строка`);
};
const number = (value: unknown, at: string, nullable = false, min = -Infinity): void => {
  if (nullable && value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) fail(`${at}: некорректное число`);
};
const array = (value: unknown, at: string): any[] => {
  if (!Array.isArray(value) || value.length > 100000) fail(`${at}: ожидается массив (до 100000 записей)`);
  return value as any[];
};
/** Необязательный размер (диаметр кабеля, лоток): отсутствие допустимо, но заданное значение должно быть > 0. */
const positiveOrEmpty = (value: unknown, at: string): void => {
  if (value === undefined || value === null) return;
  number(value, at, false, 0);
  if (value === 0) fail(`${at}: значение должно быть положительным`);
};

type Row = Record<string, any>;
type Claim = (id: unknown, at: string) => void;

interface ValidationContext {
  floorIds: Set<string>;
  equipmentIds: Set<string>;
  segmentIds: Set<string>;
  vertices: Map<string, string>;
  claim: Claim;
  pdfExists: (id: string) => boolean;
}

/** Позиция на плане: этаж должен существовать, координаты и высота — числа. */
function assertPosition(value: Row, at: string, floorIds: Set<string>): void {
  text(value.floorId, `${at}.floorId`, true);
  if (!floorIds.has(value.floorId)) fail(`Этаж не найден: ${value.floorId}`);
  number(value.x, `${at}.x`);
  number(value.y, `${at}.y`);
  number(value.height, `${at}.height`, true, 0);
}

function assertUniqueNumbers(items: Row[], at: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    object(item, at);
    text(item.number, `${at}.number`);
    const value = item.number.trim();
    if (value && seen.has(value)) fail(`Повтор номера ${at}: ${value}`);
    if (value) seen.add(value);
  }
}

function assertUniqueNames(items: Row[], at: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    object(item, at);
    text(item.name, `${at}.name`);
    const value = item.name.trim();
    if (value && seen.has(value)) fail(`Повтор имени ${at}: ${value}`);
    if (value) seen.add(value);
  }
}

function assertFloor(floor: Row, context: ValidationContext): void {
  object(floor, 'floor');
  context.claim(floor.id, 'floor.id');
  context.floorIds.add(floor.id);
  text(floor.name, 'floor.name');
  number(floor.elevation, 'floor.elevation', true);
  number(floor.metersPerUnit, 'floor.metersPerUnit', true, 0);
  if (floor.metersPerUnit === 0) fail('Масштаб должен быть положительным или null');
  number(floor.page, 'floor.page', false, 1);
  if (!Number.isInteger(floor.page)) fail('Номер страницы должен быть целым');
  number(floor.width, 'floor.width', false, 0);
  number(floor.height, 'floor.height', false, 0);
  if (floor.pdfId === undefined) return;
  text(floor.pdfId, 'floor.pdfId', true);
  const external = !floor.pdfId.startsWith('data:') && !floor.pdfId.startsWith('idb:');
  if (external && !context.pdfExists(floor.pdfId)) fail(`PDF не найден: ${floor.pdfId}`);
}

function assertPin(pin: Row, context: ValidationContext): void {
  object(pin, 'pin');
  context.claim(pin.id, 'pin.id');
  text(pin.number, 'pin.number');
  text(pin.comment, 'pin.comment');
  if (pin.status !== 'open' && pin.status !== 'closed') fail('pin.status: ожидается open или closed');
  // У замечания нет высоты: проверяем только этаж и координаты на плане.
  text(pin.floorId, 'pin.floorId', true);
  if (!context.floorIds.has(pin.floorId)) fail(`Этаж не найден: ${pin.floorId}`);
  number(pin.x, 'pin.x');
  number(pin.y, 'pin.y');
  for (const photo of array(pin.photos ?? [], 'pin.photos')) text(photo, 'pin.photos[]', true);
}

function assertEquipment(item: Row, context: ValidationContext): void {
  context.claim(item.id, 'equipment.id');
  context.equipmentIds.add(item.id);
  text(item.name, 'equipment.name');
  text(item.type, 'equipment.type');
  text(item.note, 'equipment.note');
  assertPosition(item, 'equipment', context.floorIds);
  // Цвет иконки необязателен: отсутствие допустимо, но заданный цвет обязан быть #rgb/#rrggbb.
  if (item.color !== undefined && item.color !== null && normalizeEquipmentColor(item.color) === null) fail('equipment.color: ожидается цвет #rrggbb');
  const props = object(item.properties, 'equipment.properties');
  for (const [key, value] of Object.entries(props)) {
    text(key, 'property key');
    text(value, 'property value');
  }
}

function assertVertex(raw: unknown, context: ValidationContext): void {
  const vertex = object(raw, 'vertex');
  text(vertex.id, 'vertex.id', true);
  assertPosition(vertex, 'vertex', context.floorIds);
  const signature = JSON.stringify([vertex.floorId, vertex.x, vertex.y, vertex.height]);
  const previous = context.vertices.get(vertex.id);
  if (previous !== undefined) {
    if (previous !== signature) fail(`Несогласованный ID вершины: ${vertex.id}`);
    return;
  }
  context.claim(vertex.id, 'vertex.id');
  context.vertices.set(vertex.id, signature);
}

function assertSegment(segment: Row, context: ValidationContext): void {
  object(segment, 'segment');
  context.claim(segment.id, 'segment.id');
  context.segmentIds.add(segment.id);
  if (!['orthogonal', 'spatial'].includes(segment.mode)) fail('Некорректный режим сегмента');
  number(segment.reservePercent, 'segment.reservePercent', false, 0);
  number(segment.reserveFixed, 'segment.reserveFixed', false, 0);
  for (const raw of [segment.a, segment.b]) assertVertex(raw, context);
}

function assertRoute(route: Row, context: ValidationContext): void {
  context.claim(route.id, 'route.id');
  text(route.type, 'route.type');
  text(route.note, 'route.note');
  if (route.subsystem !== undefined && !['horizontal', 'trunk', 'workplace'].includes(route.subsystem)) fail('route.subsystem: ожидается horizontal, trunk или workplace');
  // Размеры КНС необязательны: отсутствие означает «неизвестно», но заданное значение должно быть > 0.
  for (const key of ['trayWidthMm', 'trayHeightMm', 'trayAreaMm2']) positiveOrEmpty(route[key], `route.${key}`);
  if (route.color !== undefined && route.color !== null && normalizeRouteColor(route.color) === null) fail('route.color: ожидается цвет #rrggbb');
  for (const segment of array(route.segments, 'segments')) assertSegment(segment, context);
}

function assertCable(cable: Row, context: ValidationContext): void {
  context.claim(cable.id, 'cable.id');
  for (const key of ['name', 'brand', 'purpose', 'note']) text(cable[key], `cable.${key}`);
  for (const key of ['fromId', 'toId']) {
    text(cable[key], `cable.${key}`, true);
    if (!context.equipmentIds.has(cable[key])) fail(`Оборудование не найдено: ${cable[key]}`);
  }
  const used = new Set<string>();
  for (const id of array(cable.segmentIds, 'cable.segmentIds')) {
    text(id, 'segmentId', true);
    if (!context.segmentIds.has(id)) fail(`Сегмент не найден: ${id}`);
    if (used.has(id)) fail(`Повтор сегмента кабеля: ${id}`);
    used.add(id);
  }
  for (const key of ['reservePercent', 'reserveFixed', 'startReserve', 'endReserve']) number(cable[key], `cable.${key}`, false, 0);
  // Диаметр/сечение кабеля необязательны: отсутствие означает «неизвестно», но заданное значение должно быть > 0.
  for (const key of ['outerDiameterMm', 'crossSectionMm2']) positiveOrEmpty(cable[key], `cable.${key}`);
  number(cable.quantity, 'cable.quantity', false, 1);
  if (!Number.isInteger(cable.quantity)) fail('Количество кабелей должно быть целым');
}

function assertCatalogField(value: unknown): void {
  for (const raw of array(value, 'project.catalog')) {
    const entry = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    const priceOk = entry !== null && (entry.price === null || (typeof entry.price === 'number' && Number.isFinite(entry.price) && entry.price >= 0));
    const valid = entry !== null
      && (entry.kind === 'equipment' || entry.kind === 'cable' || entry.kind === 'tray')
      && typeof entry.name === 'string' && entry.name.trim() !== ''
      && typeof entry.unit === 'string'
      && priceOk
      && typeof entry.note === 'string'
      && ['manufacturer', 'article', 'series', 'size'].every(key => entry[key] === undefined || typeof entry[key] === 'string');
    if (!valid) fail('project.catalog: некорректная позиция');
  }
}

function assertEstimateField(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('project.estimate: некорректный процент работ');
  const estimate = value as Record<string, unknown>;
  if (!(estimate.laborPercent === null
    || (typeof estimate.laborPercent === 'number' && Number.isFinite(estimate.laborPercent) && estimate.laborPercent >= 0))) {
    fail('project.estimate: некорректный процент работ');
  }
  if (estimate.note !== undefined && typeof estimate.note !== 'string') fail('project.estimate: некорректное примечание');
}

function assertChangeLogField(value: unknown): void {
  if (!Array.isArray(value)) fail('project.document.changeLog: некорректная запись');
  const items = value as unknown[];
  if (items.length > 100000) fail('project.document.changeLog: некорректная запись');
  for (const item of items) {
    const entry = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
    const valid = entry !== null && ['id', 'version', 'date', 'author', 'description'].every(key => typeof entry[key] === 'string');
    if (!valid) fail('project.document.changeLog: некорректная запись');
  }
}

function assertDocumentField(value: unknown): void {
  const document = object(value, 'project.document');
  for (const key of ['compiledBy', 'checkedBy', 'date', 'organization', 'object', 'documentCode', 'city', 'title']) {
    if (document[key] !== undefined && typeof document[key] !== 'string') fail(`project.document.${key}: некорректная строка`);
  }
  if (document.changeLog !== undefined) assertChangeLogField(document.changeLog);
}

/** Structural/reference errors prevent writes; engineering incompleteness does not. */
export function assertProject(input: unknown, pdfExists: (id: string) => boolean): asserts input is Project {
  const project = object(input, 'project');
  if (project.schemaVersion !== 1 && project.schemaVersion !== 2) fail('Неподдерживаемая schemaVersion');
  text(project.id, 'project.id', true);
  text(project.name, 'project.name');
  text(project.updatedAt, 'updatedAt');

  const ids = new Set<string>();
  const claim: Claim = (id, at) => {
    text(id, at, true);
    const value = id as string;
    if (ids.has(value)) fail(`Повтор ID: ${value}`);
    ids.add(value);
  };
  claim(project.id, 'project.id');

  const floors = array(project.floors, 'floors');
  const equipment = array(project.equipment, 'equipment');
  const routes = array(project.routes, 'routes');
  const cables = array(project.cables, 'cables');
  const pins = project.schemaVersion === 2 ? array(project.pins, 'pins') : [];
  const context: ValidationContext = {
    floorIds: new Set<string>(),
    equipmentIds: new Set<string>(),
    segmentIds: new Set<string>(),
    vertices: new Map<string, string>(),
    claim,
    pdfExists,
  };

  for (const floor of floors) assertFloor(floor, context);
  assertUniqueNumbers(equipment, 'equipment');
  assertUniqueNumbers(routes, 'routes');
  assertUniqueNumbers(cables, 'cables');
  assertUniqueNumbers(pins, 'pins');
  assertUniqueNames(equipment, 'equipment');
  for (const pin of pins) assertPin(pin, context);
  for (const item of equipment) assertEquipment(item, context);
  for (const route of routes) assertRoute(route, context);
  for (const cable of cables) assertCable(cable, context);
  // Размеры между оборудованием необязательны; ссылки должны существовать и не совпадать.
  if (project.dimensions !== undefined) {
    for (const raw of array(project.dimensions, 'project.dimensions')) {
      const dimension = object(raw, 'dimension');
      context.claim(dimension.id, 'dimension.id');
      for (const key of ['fromId', 'toId']) {
        text(dimension[key], `dimension.${key}`, true);
        if (!context.equipmentIds.has(dimension[key])) fail(`Оборудование не найдено: ${dimension[key]}`);
      }
      if (dimension.fromId === dimension.toId) fail('dimension: оборудование не должно совпадать');
      if (dimension.note !== undefined) text(dimension.note, 'dimension.note');
    }
  }

  // Справочник цен и смета необязательны; заданные поля проверяются структурно (иначе 422).
  if (project.catalog !== undefined) assertCatalogField(project.catalog);
  if (project.catalogDate !== undefined && project.catalogDate !== null && !isCatalogDate(project.catalogDate)) {
    fail('project.catalogDate: ожидается дата YYYY-MM-DD');
  }
  if (project.estimate !== undefined) assertEstimateField(project.estimate);
  // Документ и лист изменений необязательны: старые проекты без них валидны.
  if (project.document !== undefined) assertDocumentField(project.document);
}

export function decodePdf(value: unknown): Buffer {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('Некорректный PDF base64');
  const bytes = Buffer.from(value as string, 'base64');
  if (!isPdf(bytes)) fail('Файл не является PDF или превышает 30 МБ');
  return bytes;
}
export function isPdf(bytes: Buffer): boolean { return bytes.length >= 5 && bytes.length <= 30 * 1024 * 1024 && bytes.subarray(0, 5).toString('ascii') === '%PDF-'; }
