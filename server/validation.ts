import type { Project } from '../src/model.js';
import { normalizeEquipmentColor } from '../src/equipment-icons.js';
import { isCatalogDate } from '../src/estimate.js';

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

/** Structural/reference errors prevent writes; engineering incompleteness does not. */
export function assertProject(input: unknown, pdfExists: (id: string) => boolean): asserts input is Project {
  const p = object(input, 'project');
  if (p.schemaVersion !== 1 && p.schemaVersion !== 2) fail('Неподдерживаемая schemaVersion');
  text(p.id, 'project.id', true); text(p.name, 'project.name'); text(p.updatedAt, 'updatedAt');
  const ids = new Set<string>();
  const claim = (id: unknown, at: string) => { text(id, at, true); if (ids.has(id as string)) fail(`Повтор ID: ${id}`); ids.add(id as string); };
  claim(p.id, 'project.id');
  const floors = array(p.floors, 'floors'); const equipment = array(p.equipment, 'equipment');
  const routes = array(p.routes, 'routes'); const cables = array(p.cables, 'cables');
  const pins = p.schemaVersion === 2 ? array(p.pins, 'pins') : [];
  const floorIds = new Set<string>(); const equipmentIds = new Set<string>(); const segmentIds = new Set<string>();
  const uniqueNumbers = (items: any[], at: string) => {
    const seen = new Set<string>();
    for (const item of items) { object(item, at); text(item.number, `${at}.number`); const n = item.number.trim(); if (n && seen.has(n)) fail(`Повтор номера ${at}: ${n}`); if (n) seen.add(n); }
  };
  for (const f of floors) {
    object(f, 'floor'); claim(f.id, 'floor.id'); floorIds.add(f.id); text(f.name, 'floor.name');
    number(f.elevation, 'floor.elevation', true); number(f.metersPerUnit, 'floor.metersPerUnit', true, 0);
    if (f.metersPerUnit === 0) fail('Масштаб должен быть положительным или null');
    number(f.page, 'floor.page', false, 1); if (!Number.isInteger(f.page)) fail('Номер страницы должен быть целым');
    number(f.width, 'floor.width', false, 0); number(f.height, 'floor.height', false, 0);
    if (f.pdfId !== undefined) { text(f.pdfId, 'floor.pdfId', true); if (!f.pdfId.startsWith('data:') && !f.pdfId.startsWith('idb:') && !pdfExists(f.pdfId)) fail(`PDF не найден: ${f.pdfId}`); }
  }
  uniqueNumbers(equipment, 'equipment'); uniqueNumbers(routes, 'routes'); uniqueNumbers(cables, 'cables'); uniqueNumbers(pins, 'pins');
  const uniqueNames = (items: any[], at: string) => {
    const seen = new Set<string>();
    for (const item of items) { object(item, at); text(item.name, `${at}.name`); const n = item.name.trim(); if (n && seen.has(n)) fail(`Повтор имени ${at}: ${n}`); if (n) seen.add(n); }
  };
  uniqueNames(equipment, 'equipment');
  const position = (v: any, at: string) => {
    text(v.floorId, `${at}.floorId`, true); if (!floorIds.has(v.floorId)) fail(`Этаж не найден: ${v.floorId}`);
    number(v.x, `${at}.x`); number(v.y, `${at}.y`); number(v.height, `${at}.height`, true, 0);
  };
  for (const pin of pins) {
    object(pin, 'pin'); claim(pin.id, 'pin.id'); text(pin.number, 'pin.number'); text(pin.comment, 'pin.comment');
    if (pin.status !== 'open' && pin.status !== 'closed') fail('pin.status: ожидается open или closed');
    text(pin.floorId, 'pin.floorId', true); if (!floorIds.has(pin.floorId)) fail(`Этаж не найден: ${pin.floorId}`);
    number(pin.x, 'pin.x'); number(pin.y, 'pin.y');
    for (const photo of array(pin.photos ?? [], 'pin.photos')) text(photo, 'pin.photos[]', true);
  }
  for (const e of equipment) {
    claim(e.id, 'equipment.id'); equipmentIds.add(e.id); text(e.name, 'equipment.name'); text(e.type, 'equipment.type'); text(e.note, 'equipment.note'); position(e, 'equipment');
    // Цвет иконки необязателен: отсутствие допустимо, но заданный цвет обязан быть #rgb/#rrggbb.
    if (e.color !== undefined && e.color !== null && normalizeEquipmentColor(e.color) === null) fail('equipment.color: ожидается цвет #rrggbb');
    const props = object(e.properties, 'equipment.properties'); for (const [k, v] of Object.entries(props)) { text(k, 'property key'); text(v, 'property value'); }
  }
  const vertices = new Map<string, string>();
  for (const r of routes) {
    claim(r.id, 'route.id'); text(r.type, 'route.type'); text(r.note, 'route.note');
    // Размеры лотка необязательны: отсутствие означает «неизвестно», но заданное значение должно быть > 0.
    for (const k of ['trayWidthMm', 'trayHeightMm', 'trayAreaMm2']) positiveOrEmpty(r[k], `route.${k}`);
    for (const s of array(r.segments, 'segments')) {
      object(s, 'segment'); claim(s.id, 'segment.id'); segmentIds.add(s.id);
      if (!['orthogonal', 'spatial'].includes(s.mode)) fail('Некорректный режим сегмента');
      number(s.reservePercent, 'segment.reservePercent', false, 0); number(s.reserveFixed, 'segment.reserveFixed', false, 0);
      for (const raw of [s.a, s.b]) {
        const v = object(raw, 'vertex'); text(v.id, 'vertex.id', true); position(v, 'vertex');
        const signature = JSON.stringify([v.floorId, v.x, v.y, v.height]);
        if (vertices.has(v.id)) { if (vertices.get(v.id) !== signature) fail(`Несогласованный ID вершины: ${v.id}`); }
        else { claim(v.id, 'vertex.id'); vertices.set(v.id, signature); }
      }
    }
  }
  for (const c of cables) {
    claim(c.id, 'cable.id'); for (const k of ['name', 'brand', 'purpose', 'note']) text(c[k], `cable.${k}`);
    for (const k of ['fromId', 'toId']) { text(c[k], `cable.${k}`, true); if (!equipmentIds.has(c[k])) fail(`Оборудование не найдено: ${c[k]}`); }
    const chain = array(c.segmentIds, 'cable.segmentIds'); const used = new Set<string>();
    for (const id of chain) { text(id, 'segmentId', true); if (!segmentIds.has(id)) fail(`Сегмент не найден: ${id}`); if (used.has(id)) fail(`Повтор сегмента кабеля: ${id}`); used.add(id); }
    for (const k of ['reservePercent', 'reserveFixed', 'startReserve', 'endReserve']) number(c[k], `cable.${k}`, false, 0);
    // Диаметр/сечение кабеля необязательны: отсутствие означает «неизвестно», но заданное значение должно быть > 0.
    for (const k of ['outerDiameterMm', 'crossSectionMm2']) positiveOrEmpty(c[k], `cable.${k}`);
    number(c.quantity, 'cable.quantity', false, 1); if (!Number.isInteger(c.quantity)) fail('Количество кабелей должно быть целым');
  }
  // Справочник цен и смета необязательны; заданные поля проверяются структурно (иначе 422).
  if (p.catalog !== undefined) {
    for (const item of array(p.catalog, 'project.catalog')) {
      const entry = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
      const priceOk = entry !== null && (entry.price === null || (typeof entry.price === 'number' && Number.isFinite(entry.price) && entry.price >= 0));
      const valid = entry !== null
        && (entry.kind === 'equipment' || entry.kind === 'cable' || entry.kind === 'tray')
        && typeof entry.name === 'string' && entry.name.trim() !== ''
        && typeof entry.unit === 'string'
        && priceOk
        && typeof entry.note === 'string';
      if (!valid) fail('project.catalog: некорректная позиция');
    }
  }
  if (p.catalogDate !== undefined && p.catalogDate !== null && !isCatalogDate(p.catalogDate)) {
    fail('project.catalogDate: ожидается дата YYYY-MM-DD');
  }
  if (p.estimate !== undefined) {
    if (!p.estimate || typeof p.estimate !== 'object' || Array.isArray(p.estimate)) fail('project.estimate: некорректный процент работ');
    const estimate = p.estimate as Record<string, unknown>;
    if (!(estimate.laborPercent === null
      || (typeof estimate.laborPercent === 'number' && Number.isFinite(estimate.laborPercent) && estimate.laborPercent >= 0))) {
      fail('project.estimate: некорректный процент работ');
    }
    if (estimate.note !== undefined && typeof estimate.note !== 'string') fail('project.estimate: некорректное примечание');
  }
  // Документ и лист регистрации изменений необязательны: старые проекты без них валидны,
  // а заданные поля должны быть строками (иначе 422).
  if (p.document !== undefined) {
    const document = object(p.document, 'project.document');
    for (const key of ['compiledBy', 'checkedBy', 'date', 'organization', 'object', 'documentCode', 'city', 'title']) {
      if (document[key] !== undefined && typeof document[key] !== 'string') fail(`project.document.${key}: некорректная строка`);
    }
    if (document.changeLog !== undefined) {
      if (!Array.isArray(document.changeLog) || document.changeLog.length > 100000) fail('project.document.changeLog: некорректная запись');
      for (const item of document.changeLog) {
        const entry = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
        const valid = entry !== null
          && ['id', 'version', 'date', 'author', 'description'].every(key => typeof entry[key] === 'string');
        if (!valid) fail('project.document.changeLog: некорректная запись');
      }
    }
  }
}

export function decodePdf(value: unknown): Buffer {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('Некорректный PDF base64');
  const bytes = Buffer.from(value as string, 'base64');
  if (!isPdf(bytes)) fail('Файл не является PDF или превышает 30 МБ');
  return bytes;
}
export function isPdf(bytes: Buffer): boolean { return bytes.length >= 5 && bytes.length <= 30 * 1024 * 1024 && bytes.subarray(0, 5).toString('ascii') === '%PDF-'; }
