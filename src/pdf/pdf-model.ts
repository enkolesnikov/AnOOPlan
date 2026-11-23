// Модель печатной формы: типы разделов, константы листа и штампа, текстовые утилиты.
// Ничего не рисует — только данные и чистые функции; рисует pdf-renderer.ts.
import { rgb, type PDFFont } from 'pdf-lib';
import type { Cable } from '../model';

export interface JournalPhoto { number: string; name: string; data: ArrayBuffer; mime: string }
export interface JournalPlan { title: string; png: Uint8Array; note?: string }

/** Раздел печатной формы; `include` в {@link JournalOptions} фильтрует их набор. */
export type JournalSectionId =
  | 'journal'
  | 'equipment'
  | 'cables'
  | 'routeScheme'
  | 'knSSpec'
  | 'infrastructure'
  | 'trayFill'
  | 'estimate'
  | 'commercial'
  | 'pins'
  | 'warnings'
  | 'plans'
  | 'photos'
  | 'pinPhotos'
  | 'changeLog';

/** Все разделы печатной формы в порядке вывода (титул и оглавление выводятся всегда). */
export const DEFAULT_JOURNAL_SECTIONS: JournalSectionId[] = [
  'journal',
  'equipment',
  'cables',
  'routeScheme',
  'knSSpec',
  'infrastructure',
  'trayFill',
  'estimate',
  'commercial',
  'pins',
  'changeLog',
  'plans',
  'photos',
  'pinPhotos',
  'warnings',
];

/**
 * Формат листа печати. Портрет не поддерживается осознанно: широкие таблицы
 * (15 колонок журнала) в него не влезают, а горизонт A4/A3 — рабочий стандарт.
 */
export type JournalFormat = 'a4l' | 'a3l';

export interface JournalOptions {
  photos?: JournalPhoto[];
  pinPhotos?: JournalPhoto[];
  plans?: JournalPlan[];
  /** Какие разделы печатать; `undefined` — все ({@link DEFAULT_JOURNAL_SECTIONS}). */
  include?: JournalSectionId[];
  /** Формат листа; по умолчанию A4 landscape (842×595). */
  format?: JournalFormat;
  /** Масштаб кегля и высоты строк таблиц, 0.85…1.15; вне диапазона — 1. */
  scale?: number;
}

export const PAGE_SIZES: Record<JournalFormat, { width: number; height: number }> = {
  a4l: { width: 842, height: 595 },
  a3l: { width: 1191, height: 842 },
};

/** Пунктов в миллиметре: 185×40 мм основной надписи ГОСТ 2.104 — 524,4×113,4 pt. */
const MM = 2.83465;
export const STAMP_WIDTH = 185 * MM;
export const STAMP_HEIGHT = 40 * MM;
const SCALE_MIN = 0.85;
const SCALE_MAX = 1.15;

export const BRAND = rgb(0.07, 0.16, 0.21);
export const MUTED = rgb(0.39, 0.46, 0.5);
export const BORDER = rgb(0.83, 0.87, 0.88);
export const ZEBRA = rgb(0.965, 0.973, 0.976);
export const DANGER = rgb(0.86, 0.31, 0.44);
export const WHITE = rgb(1, 1, 1);

/** Формат листа из внешних данных: неизвестный — A4 landscape, а не ошибка. */
export const normalizeFormat = (format: JournalFormat | undefined): JournalFormat =>
  format === 'a3l' ? 'a3l' : 'a4l';

/** Масштаб таблиц: только 0.85…1.15, иначе 1 (не «примерно 1», а ровно). */
export const normalizeScale = (scale: number | undefined): number =>
  typeof scale === 'number' && Number.isFinite(scale) && scale >= SCALE_MIN && scale <= SCALE_MAX ? scale : 1;


export const formatNumber = (value: number | null): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
};

/**
 * Деньги в документе — не больше копеек. До 2.10.1 смета печатала «28 783,675 ₽»:
 * процент работ от дробных материалов даёт третью цифру после запятой, а рубли
 * в печатной форме живут до копейки.
 */
export const formatMoney = (value: number | null): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** Дата документа в русском виде ДД.ММ.ГГГГ; ISO-строка модели — для данных, не для печати. */
export function formatDateRu(value: string | null | undefined): string {
  const text = (value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return text || '—';
  return `${match[3]}.${match[2]}.${match[1]}`;
}

/** Внешний диаметр кабеля: незаданное значение не подменяется нулём. */
export const cableDiameter = (cable: Cable): number | null => {
  const value = cable.outerDiameterMm;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

export interface Column { title: string; width: number; align?: 'left' | 'right' }
/** Строка таблицы: обычная или выделенная (подытог: полужирная первая ячейка и фон ZEBRA). */
export type TableRow = string[] | { cells: string[]; bold?: boolean; zebra?: boolean };
export interface Section { id: JournalSectionId; title: string; note?: string; columns: Column[]; rows: TableRow[]; emptyText?: string; footer?: string }
export interface TocEntry { title: string; page: number }

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of String(text).split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let current = '';
    const flush = () => { if (current) { lines.push(current); current = ''; } };
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { current = candidate; continue; }
      flush();
      if (font.widthOfTextAtSize(word, size) <= maxWidth) { current = word; continue; }
      // Очень длинный идентификатор: рвём по символам, чтобы не вылезти за колонку.
      let chunk = '';
      for (const character of word) {
        if (font.widthOfTextAtSize(chunk + character, size) > maxWidth && chunk) { lines.push(chunk); chunk = character; }
        else chunk += character;
      }
      current = chunk;
    }
    flush();
  }
  return lines.length ? lines : [''];
}

/** Обрезает строку по ширине многоточием (для узких ячеек штампа). */
export function fitText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) result = result.slice(0, -1);
  return `${result}…`;
}

/** Разбор строки таблицы: обычный массив или объект с оформлением подытога. */
export const rowCells = (row: TableRow): string[] => (Array.isArray(row) ? row : row.cells);
export const rowBold = (row: TableRow): boolean => !Array.isArray(row) && row.bold === true;
export const rowZebra = (row: TableRow): boolean => !Array.isArray(row) && row.zebra === true;
