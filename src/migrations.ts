import type { Project } from './model';

/**
 * Текущая версия схемы проекта. Пока это 1; каркас миграций нужен, чтобы
 * добавлять v2, v3 и т.д. без риска потерять старые проекты.
 */
export const CURRENT_SCHEMA_VERSION = 1;

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
 * Миграции "с версии N на N+1". Пока пусто; при добавлении v2 сюда
 * кладётся функция 1 → 2, и migrateProject применит её к старым файлам.
 */
const MIGRATIONS: Record<number, (project: RawProject) => RawProject> = {};

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
  } as Project['routes'][number];
}

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
    schemaVersion: 1,
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Проект',
    floors: raw.floors.map(normalizeFloor),
    equipment: raw.equipment.map(normalizeEquipment),
    routes: raw.routes.map(normalizeRoute),
    cables: raw.cables.map(normalizeCable),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
  if (isRecord(raw.document)) {
    const document = raw.document;
    project.document = {
      compiledBy: typeof document.compiledBy === 'string' ? document.compiledBy : undefined,
      checkedBy: typeof document.checkedBy === 'string' ? document.checkedBy : undefined,
      date: typeof document.date === 'string' ? document.date : undefined,
    };
  }
  return project;
}
