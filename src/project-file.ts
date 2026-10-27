import type { Project } from './model';
import { migrateProject, ProjectSchemaError } from './migrations';
import type { AttachmentManifest } from './attachment-manifest';

/**
 * Файл проекта AnOOPlan (`.anooplan`) — JSON-формат обмена проектом вместе с
 * вложенными исходными PDF и фотографиями. Проект нормализуется через
 * `migrateProject`, поэтому старые файлы открываются без потери данных.
 */

export const ANOOPLAN_EXTENSION = '.anooplan';
export const ANOOPLAN_MIME = 'application/vnd.anooplan.project';
export const ANOOPLAN_FORMAT = 'anooplan';
export const ANOOPLAN_FORMAT_VERSION = 1;

/** Вложенный исходный PDF: `id` — тот же id, на который ссылается `Floor.pdfId`. */
export interface ProjectPdfAttachment { id: string; name: string; dataBase64: string }
/** Вложенная фотография: `key` — ключ, хранящийся в `Equipment.photos`/`Pin.photos`. */
export interface ProjectPhotoAttachment { key: string; name: string; mime: string; dataBase64: string }

export interface AnoPlanFile {
  format: 'anooplan';
  formatVersion: 1;
  project: Project;
  pdfs: ProjectPdfAttachment[];
  photos: ProjectPhotoAttachment[];
  /** SHA-256 манифест вложений; необязателен для файлов старых версий. */
  manifest?: AttachmentManifest;
  exportedAt: string;
}

export type ParsedProjectFile =
  | { kind: 'file'; project: Project; pdfs: ProjectPdfAttachment[]; photos: ProjectPhotoAttachment[]; manifest?: AttachmentManifest }
  | { kind: 'project'; project: Project };

const NOT_A_PROJECT = 'Файл не является проектом AnOOPlan.';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Имя файла проекта: расширение `.anooplan` без учёта регистра. */
export function isAnoPlanFileName(name: string): boolean {
  return typeof name === 'string' && name.trim().toLowerCase().endsWith(ANOOPLAN_EXTENSION);
}

/** Собирает объект файла `.anooplan` (сериализуется через `serializeAnoPlanFile`). */
export function buildAnoPlanFile(
  project: Project,
  pdfs: ProjectPdfAttachment[] = [],
  photos: ProjectPhotoAttachment[] = [],
  manifest?: AttachmentManifest,
): AnoPlanFile {
  return {
    format: ANOOPLAN_FORMAT,
    formatVersion: ANOOPLAN_FORMAT_VERSION,
    project,
    pdfs,
    photos,
    ...(manifest ? { manifest } : {}),
    exportedAt: new Date().toISOString(),
  };
}

/** Сериализует файл в JSON (с отступами — файл читаем людьми и diff'ами). */
export function serializeAnoPlanFile(file: AnoPlanFile): string {
  return JSON.stringify(file, null, 2);
}

function normalizePdfAttachments(value: unknown): ProjectPdfAttachment[] {
  if (!Array.isArray(value)) return [];
  const result: ProjectPdfAttachment[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = trimmed(item.id);
    const name = trimmed(item.name);
    const dataBase64 = typeof item.dataBase64 === 'string' ? item.dataBase64 : '';
    if (!id || !name || !dataBase64) continue;
    result.push({ id, name, dataBase64 });
  }
  return result;
}

function normalizePhotoAttachments(value: unknown): ProjectPhotoAttachment[] {
  if (!Array.isArray(value)) return [];
  const result: ProjectPhotoAttachment[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const key = trimmed(item.key);
    const name = trimmed(item.name);
    const mime = trimmed(item.mime) || 'image/jpeg';
    const dataBase64 = typeof item.dataBase64 === 'string' ? item.dataBase64 : '';
    if (!key || !name || !dataBase64) continue;
    result.push({ key, name, mime, dataBase64 });
  }
  return result;
}

/**
 * Разбирает содержимое файла `.anooplan`, резервную копию
 * `{ project, pdfs, photos }` или «голый» JSON-проект.
 *
 * Повреждённые вложения отбрасываются, проект нормализуется миграциями;
 * ошибки схемы проекта (`ProjectSchemaError`) пробрасываются как есть.
 */
export function parseAnoPlanFile(input: unknown): ParsedProjectFile {
  if (!isRecord(input)) throw new ProjectSchemaError(NOT_A_PROJECT);

  if (input.format === ANOOPLAN_FORMAT) {
    if (!isRecord(input.project)) throw new ProjectSchemaError(NOT_A_PROJECT);
    // Формат новее поддерживаемого не парсим: непонятные поля нельзя терять молча.
    const formatVersion = input.formatVersion;
    if (typeof formatVersion === 'number' && Number.isFinite(formatVersion) && formatVersion > ANOOPLAN_FORMAT_VERSION) {
      throw new ProjectSchemaError(
        `Файл создан более новой версией AnOOPlan (формат ${formatVersion}). Обновите приложение.`,
      );
    }
    return {
      kind: 'file',
      project: migrateProject(input.project),
      pdfs: normalizePdfAttachments(input.pdfs),
      photos: normalizePhotoAttachments(input.photos),
      ...(isRecord(input.manifest) ? { manifest: input.manifest as unknown as AttachmentManifest } : {}),
    };
  }

  if ('project' in input) {
    // Legacy-копия: { schemaVersion, project, pdfs, photos }.
    return {
      kind: 'file',
      project: migrateProject(input.project),
      pdfs: normalizePdfAttachments(input.pdfs),
      photos: normalizePhotoAttachments(input.photos),
      ...(isRecord(input.manifest) ? { manifest: input.manifest as unknown as AttachmentManifest } : {}),
    };
  }

  if ('id' in input && 'floors' in input) {
    return { kind: 'project', project: migrateProject(input) };
  }

  throw new ProjectSchemaError(NOT_A_PROJECT);
}
