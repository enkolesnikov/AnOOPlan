import type { ChangeEntry, Dimension, Project } from './model';
import { normalizeEquipmentColor } from './equipment-icons';
import { isCatalogDate, normalizeCatalog } from './estimate';
import { normalizeRouteColor } from './route-kinds';

/**
 * Текущая версия схемы проекта. Пока это 1; каркас миграций нужен, чтобы
 * добавлять v2, v3 и т.д. без риска потерять старые проекты.
 */
export const CURRENT_SCHEMA_VERSION = 2;

export class ProjectSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectSchemaError';
  }
}

type RawProject = Record<string, unknown>;

const isRecord = (value: unknown): value is RawProject =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Необязательное числовое поле из JSON: отсутствие (null/undefined) и мусор
 * (не число, NaN, Infinity, пустая строка, boolean, массив) превращаются в undefined,
 * а не в 0. Строки с числом («6.5») допускаются для совместимости со старыми копиями.
 * Отрицательные и нулевые значения сохраняются — их проверяет движок.
 */
const optionalNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
};

/**
 * Миграции "с версии N на N+1". Пока пусто; при добавлении v2 сюда
 * кладётся функция 1 → 2, и migrateProject применит её к старым файлам.
 */
const MIGRATIONS: Record<number, (project: RawProject) => RawProject> = {
  1: project => ({ ...project, schemaVersion: 2, pins: [] }),
};

function normalizeFloor(value: unknown): Project['floors'][number] {
  if (!isRecord(value)) throw new ProjectSchemaError('В проекте повреждён список этажей.');
  const width = Number(value.width);
  const height = Number(value.height);
  const floor: Project['floors'][number] = {
    id: String(value.id ?? ''),
    name: typeof value.name === 'string' && value.name ? value.name : 'Этаж',
    elevation: typeof value.elevation === 'number' ? value.elevation : null,
    metersPerUnit: typeof value.metersPerUnit === 'number' && value.metersPerUnit > 0 ? value.metersPerUnit : null,
    page: Number.isInteger(value.page) && Number(value.page) > 0 ? Number(value.page) : 1,
    width: Number.isFinite(width) && width > 0 ? width : 1000,
    height: Number.isFinite(height) && height > 0 ? height : 700,
  };
  if (typeof value.pdfId === 'string') floor.pdfId = value.pdfId;
  return floor;
}

function normalizeEquipment(value: unknown): Project['equipment'][number] {
  if (!isRecord(value)) throw new ProjectSchemaError('В проекте повреждён список оборудования.');
  const photos = Array.isArray(value.photos) ? value.photos.filter((key): key is string => typeof key === 'string' && key.length > 0) : [];
  return {
    id: String(value.id ?? ''),
    number: typeof value.number === 'string' ? value.number : '',
    name: typeof value.name === 'string' ? value.name : '',
    type: typeof value.type === 'string' ? value.type : 'Оборудование',
    floorId: String(value.floorId ?? ''),
    x: Number(value.x) || 0,
    y: Number(value.y) || 0,
    height: typeof value.height === 'number' ? value.height : null,
    note: typeof value.note === 'string' ? value.note : '',
    properties: isRecord(value.properties)
      ? Object.fromEntries(Object.entries(value.properties).map(([key, item]) => [key, String(item ?? '')]))
      : {},
    photos,
    // Цвет иконки необязателен: валидный #rgb/#rrggbb приводится к #rrggbb,
    // мусор и не-строки не заменяются дефолтом молча, а считаются отсутствующими.
    color: normalizeEquipmentColor(value.color) ?? undefined,
  };
}

function normalizeRoute(value: unknown): Project['routes'][number] {
  if (!isRecord(value)) throw new ProjectSchemaError('В проекте повреждён список трасс.');
  return {
    id: String(value.id ?? ''),
    number: typeof value.number === 'string' ? value.number : '',
    type: typeof value.type === 'string' ? value.type : 'Трасса',
    segments: Array.isArray(value.segments) ? value.segments : [],
    note: typeof value.note === 'string' ? value.note : '',
    trayWidthMm: optionalNumber(value.trayWidthMm),
    trayHeightMm: optionalNumber(value.trayHeightMm),
    trayAreaMm2: optionalNumber(value.trayAreaMm2),
    // Цвет трассы необязателен: валидный #rgb/#rrggbb приводится к #rrggbb, мусор считается отсутствующим.
    color: normalizeRouteColor(value.color) ?? undefined,
  } as Project['routes'][number];
}

function normalizePin(value: unknown): Project['pins'][number] {
  if (!isRecord(value)) throw new ProjectSchemaError('В проекте повреждён список замечаний.');
  const status = value.status === 'closed' ? 'closed' : 'open';
  const now = new Date().toISOString();
  return {
    id: String(value.id ?? ''),
    number: typeof value.number === 'string' ? value.number : '',
    floorId: String(value.floorId ?? ''),
    x: Number(value.x) || 0,
    y: Number(value.y) || 0,
    comment: typeof value.comment === 'string' ? value.comment : '',
    status,
    photos: Array.isArray(value.photos) ? value.photos.filter((key): key is string => typeof key === 'string' && key.length > 0) : [],
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
  };
}

const stringValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Размер между оборудованием: нечисловые id отбрасываются, полностью пустые записи не сохраняются. */
function normalizeDimension(value: unknown): Dimension | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const fromId = stringValue(value.fromId);
  const toId = stringValue(value.toId);
  if (!id || !fromId || !toId || fromId === toId) return null;
  return { id, fromId, toId, note: typeof value.note === 'string' ? value.note : '' };
}

/** Запись листа регистрации изменений: мусорные и полностью пустые записи отбрасываются. */
function normalizeChangeEntry(value: unknown, index: number): ChangeEntry | null {
  if (!isRecord(value)) return null;
  const version = stringValue(value.version);
  const date = stringValue(value.date);
  const author = stringValue(value.author);
  const description = stringValue(value.description);
  if (!version && !date && !author && !description) return null;
  return {
    id: stringValue(value.id) || `change-${index + 1}`,
    version,
    date,
    author,
    description,
  };
}

const normalizeDocument = (value: unknown): Project['document'] => {
  if (!isRecord(value)) return undefined;
  const document: Project['document'] = {
    // Старые поля сохраняем как раньше; новые строки титульного листа нормализуем.
    compiledBy: typeof value.compiledBy === 'string' ? value.compiledBy : undefined,
    checkedBy: typeof value.checkedBy === 'string' ? value.checkedBy : undefined,
    date: typeof value.date === 'string' ? value.date : undefined,
    organization: stringValue(value.organization) || undefined,
    object: stringValue(value.object) || undefined,
    documentCode: stringValue(value.documentCode) || undefined,
    city: stringValue(value.city) || undefined,
    title: stringValue(value.title) || undefined,
  };
  if (Array.isArray(value.changeLog)) {
    const changeLog = value.changeLog
      .map((entry, index) => normalizeChangeEntry(entry, index))
      .filter((entry): entry is ChangeEntry => entry !== null);
    // Fallback-id `change-N` может совпасть с явным id: дубли ломают удаление строк в интерфейсе.
    const used = new Set<string>();
    const unique = changeLog.map((entry, index) => {
      let id = entry.id;
      if (used.has(id)) {
        let suffix = index + 2;
        while (used.has(`change-${suffix}`)) suffix += 1;
        id = `change-${suffix}`;
      }
      used.add(id);
      return { ...entry, id };
    });
    // Пустой список не храним: «нет изменений» — это отсутствие поля, а не массив-заглушка.
    if (unique.length) document.changeLog = unique;
  }
  return document;
};

function normalizeCable(value: unknown): Project['cables'][number] {
  if (!isRecord(value)) throw new ProjectSchemaError('В проекте повреждён список кабелей.');
  return {
    ...(value as unknown as Project['cables'][number]),
    id: String(value.id ?? ''),
    number: typeof value.number === 'string' ? value.number : '',
    name: typeof value.name === 'string' ? value.name : '',
    brand: typeof value.brand === 'string' ? value.brand : '',
    purpose: typeof value.purpose === 'string' ? value.purpose : '',
    fromId: String(value.fromId ?? ''),
    toId: String(value.toId ?? ''),
    segmentIds: Array.isArray(value.segmentIds) ? value.segmentIds.filter((id): id is string => typeof id === 'string') : [],
    reservePercent: Number(value.reservePercent) || 0,
    reserveFixed: Number(value.reserveFixed) || 0,
    startReserve: Number(value.startReserve) || 0,
    endReserve: Number(value.endReserve) || 0,
    quantity: Number(value.quantity) > 0 ? Number(value.quantity) : 1,
    note: typeof value.note === 'string' ? value.note : '',
    pricePerMeter: typeof value.pricePerMeter === 'number' ? value.pricePerMeter : undefined,
    outerDiameterMm: optionalNumber(value.outerDiameterMm),
    crossSectionMm2: optionalNumber(value.crossSectionMm2),
  };
}

/**
 * Приводит загруженный проект к текущей схеме.
 *
 * - проект без `schemaVersion` считается v1 (старые JSON-копии);
 * - проект из будущей версии отклоняется с понятным сообщением;
 * - отсутствующие необязательные поля нормализуются, а не роняют загрузку.
 */
export function migrateProject(input: unknown): Project {
  if (!isRecord(input)) throw new ProjectSchemaError('Файл не является проектом AnOOPlan.');
  const version = input.schemaVersion === undefined ? 1 : Number(input.schemaVersion);
  if (!Number.isInteger(version) || version < 1) {
    throw new ProjectSchemaError('Неизвестная версия схемы проекта.');
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new ProjectSchemaError(`Проект создан более новой версией AnOOPlan (schemaVersion ${version}). Обновите приложение.`);
  }

  let raw: RawProject = { ...input };
  for (let current = version; current < CURRENT_SCHEMA_VERSION; current += 1) {
    const migration = MIGRATIONS[current];
    if (!migration) throw new ProjectSchemaError(`Нет миграции схемы ${current} → ${current + 1}.`);
    raw = migration(raw);
  }

  if (!Array.isArray(raw.floors) || !Array.isArray(raw.equipment) || !Array.isArray(raw.routes) || !Array.isArray(raw.cables)) {
    throw new ProjectSchemaError('В проекте отсутствуют обязательные списки этажей, оборудования, трасс или кабелей.');
  }
  if (typeof raw.id !== 'string' || !raw.id) {
    throw new ProjectSchemaError('В проекте отсутствует идентификатор.');
  }

  const project: Project = {
    schemaVersion: 2,
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Проект',
    floors: raw.floors.map(normalizeFloor),
    equipment: raw.equipment.map(normalizeEquipment),
    routes: raw.routes.map(normalizeRoute),
    cables: raw.cables.map(normalizeCable),
    pins: Array.isArray(raw.pins) ? raw.pins.map(normalizePin) : [],
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
  if (Array.isArray(raw.dimensions)) {
    const dimensions = raw.dimensions
      .map(normalizeDimension)
      .filter((item): item is Dimension => item !== null);
    if (dimensions.length) project.dimensions = dimensions;
  }
  // Справочник цен и дата прайса необязательны; повреждённые/отсутствующие поля
  // нормализуются, а старые проекты грузятся как раньше.
  project.catalog = normalizeCatalog(raw.catalog);
  if (isCatalogDate(raw.catalogDate)) project.catalogDate = raw.catalogDate;
  const document = normalizeDocument(raw.document);
  if (document) project.document = document;
  if (isRecord(raw.estimate)) {
    const source = raw.estimate;
    project.estimate = {
      laborPercent: typeof source.laborPercent === 'number' && Number.isFinite(source.laborPercent) && source.laborPercent >= 0
        ? source.laborPercent
        : null,
      note: typeof source.note === 'string' ? source.note : '',
    };
  }
  return project;
}
