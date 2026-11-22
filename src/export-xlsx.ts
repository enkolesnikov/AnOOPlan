// Офлайн-выгрузка в Excel: тот же набор листов, что отдаёт сервер.
// Закрепление шапки Community-редакция SheetJS не умеет — его делает xlsx-freeze
// правкой ZIP после записи книги.
import * as XLSX from 'xlsx';
import type { Cell, ExportSheet } from './sheets';

/** Минимальная и максимальная ширина колонки в символах. */
const MIN_COLUMN_WIDTH = 8;
const MAX_COLUMN_WIDTH = 48;
/** Колонки с числами (деньги, метры) не шире: числа короткие, шапку не растягиваем. */
const MAX_NUMERIC_COLUMN_WIDTH = 16;
/** Высота строки шапки в пунктах. */
const HEADER_ROW_HEIGHT_PT = 30;
/** Excel ограничивает имена листов 31 символом. */
const MAX_SHEET_NAME_LENGTH = 31;

/** Длина значения для оценки ширины; null/пусто не занимают места. */
function displayLength(cell: Cell | undefined): number {
  if (cell === null || cell === undefined || cell === '') return 0;
  return String(cell).length;
}

/**
 * Ширины по содержимому: максимум из длины шапки и значений плюс два символа.
 * Заголовок учитывается всегда, даже если данных в колонке нет.
 */
function columnWidths(rows: Cell[][]): XLSX.ColInfo[] {
  const header = rows[0] ?? [];
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const widths: XLSX.ColInfo[] = [];
  for (let column = 0; column < columnCount; column += 1) {
    let longest = displayLength(header[column]);
    let numericOnly = true;
    let hasValue = false;
    for (let row = 1; row < rows.length; row += 1) {
      const value = rows[row][column];
      if (value === null || value === undefined || value === '') continue;
      hasValue = true;
      longest = Math.max(longest, displayLength(value));
      if (typeof value !== 'number') numericOnly = false;
    }
    const max = hasValue && numericOnly ? MAX_NUMERIC_COLUMN_WIDTH : MAX_COLUMN_WIDTH;
    widths.push({ wch: Math.min(Math.max(longest + 2, MIN_COLUMN_WIDTH), max) });
  }
  return widths;
}

/** Диапазон таблицы A1:…: шапка плюс строки данных; без данных — только шапка. */
function tableRange(rows: Cell[][]): string | null {
  if (rows.length === 0 || rows[0].length === 0) return null;
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (columnCount === 0) return null;
  return `A1:${XLSX.utils.encode_col(columnCount - 1)}${rows.length}`;
}

/** Имя листа без недопустимых символов; пустое имя заменяется на «Лист». */
function safeSheetName(raw: string): string {
  const cleaned = raw.replace(/[[\]:*?/\\]/g, ' ').replace(/'/g, ' ').trim();
  return (cleaned || 'Лист').slice(0, MAX_SHEET_NAME_LENGTH);
}

/** Уникальное имя после обрезки: Excel не различает регистр и не терпит дублей. */
function uniqueSheetName(raw: string, used: Set<string>): string {
  const base = safeSheetName(raw);
  let name = base;
  let index = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${index})`;
    name = `${base.slice(0, MAX_SHEET_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
    index += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

/**
 * Собрать книгу: отдельные листы журнала/КНС/сметы, ширины колонок,
 * автофильтр по шапке и высокая строка заголовков.
 * Функция синхронная; закрепление шапки — отдельный freezeHeaderRows.
 */
export function buildWorkbook(sheets: ExportSheet[]): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    const widths = columnWidths(sheet.rows);
    if (widths.length > 0) worksheet['!cols'] = widths;
    if (sheet.rows.length > 0) worksheet['!rows'] = [{ hpt: HEADER_ROW_HEIGHT_PT }];
    const range = tableRange(sheet.rows);
    if (range) worksheet['!autofilter'] = { ref: range };
    XLSX.utils.book_append_sheet(workbook, worksheet, uniqueSheetName(sheet.name, usedNames));
  }
  const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array;
  return output instanceof Uint8Array ? output : new Uint8Array(output);
}

export { freezeHeaderRows } from './xlsx-freeze';
