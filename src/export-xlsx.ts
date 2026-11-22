// Офлайн-выгрузка в Excel: тот же набор листов, что отдаёт сервер.
// Закрепление шапки Community-редакция SheetJS не умеет — его делает xlsx-freeze
// правкой ZIP после записи книги.
import * as XLSX from 'xlsx';
import type { Cell, ExportSheet } from './sheets';

/** Минимальная и максимальная ширина колонки в символах. */
const MIN_COLUMN_WIDTH = 8;
const MAX_COLUMN_WIDTH = 48;
/**
 * Числовые колонки не шире этой границы: числа короткие, а деньги не должны
 * получать 48 символов. 24 — самый длинный числовой заголовок книги
 * («Сегментов с превышением»), чтобы шапка не обрезалась.
 */
const MAX_NUMERIC_COLUMN_WIDTH = 24;
/** Высота строки шапки в пунктах. */
const HEADER_ROW_HEIGHT_PT = 30;
/** Excel ограничивает имена листов 31 символом. */
const MAX_SHEET_NAME_LENGTH = 31;
/** Денежные ячейки: группировка тысяч и копейки. */
const MONEY_FORMAT = '#,##0.00';
/** Денежная колонка по заголовку; метры и штуки остаются без формата. */
const MONEY_HEADER = /₽|цена|сумма|стоимость/i;

/** Длина значения для оценки ширины; null/пусто не занимают места. */
function displayLength(cell: Cell | undefined): number {
  if (cell === null || cell === undefined || cell === '') return 0;
  return String(cell).length;
}

/**
 * Ширины по содержимому: максимум из длины шапки и значений плюс два символа.
 * Заголовок учитывается всегда, даже если данных в колонке нет; headerRow —
 * строка шапки (у «Коммерческого предложения» она не первая).
 */
function columnWidths(rows: Cell[][], headerRow: number): XLSX.ColInfo[] {
  const header = rows[headerRow] ?? [];
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const widths: XLSX.ColInfo[] = [];
  for (let column = 0; column < columnCount; column += 1) {
    let longest = displayLength(header[column]);
    let numericOnly = true;
    let hasValue = false;
    for (let row = 0; row < rows.length; row += 1) {
      if (row === headerRow) continue;
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

/**
 * Диапазон таблицы от шапки до последней строки данных. Итоги и служебные
 * строки за пределами table в фильтр не попадают; fromRow/toRow — 0-based.
 */
function tableRange(rows: Cell[][], table: { fromRow: number; toRow: number }): string | null {
  if (rows.length === 0) return null;
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (columnCount === 0) return null;
  const firstRow = Math.min(Math.max(table.fromRow, 0), rows.length - 1);
  const lastRow = Math.min(Math.max(table.toRow, firstRow), rows.length - 1);
  const first = XLSX.utils.encode_cell({ r: firstRow, c: 0 });
  const last = XLSX.utils.encode_cell({ r: lastRow, c: columnCount - 1 });
  return `${first}:${last}`;
}

/**
 * Формат денежных ячеек по заголовку колонки. Текст, пустые и нечисловые
 * ячейки не трогаем: формат на строке «—» или подписи выглядел бы чужим.
 */
function applyMoneyFormat(worksheet: XLSX.WorkSheet, rows: Cell[][], headerRow: number): void {
  const header = rows[headerRow] ?? [];
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  for (let column = 0; column < columnCount; column += 1) {
    const title = header[column];
    if (typeof title !== 'string' || !MONEY_HEADER.test(title)) continue;
    for (let row = headerRow + 1; row < rows.length; row += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined;
      if (cell?.t === 'n') cell.z = MONEY_FORMAT;
    }
  }
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
 * автофильтр по таблице (если лист её описывает), формат денег и высокая
 * строка заголовков. Функция синхронная; закрепление шапки — отдельный
 * freezeHeaderRows.
 */
export function buildWorkbook(sheets: ExportSheet[]): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    const headerRow = sheet.table?.fromRow ?? 0;
    const widths = columnWidths(sheet.rows, headerRow);
    if (widths.length > 0) worksheet['!cols'] = widths;
    if (sheet.rows.length > 0) {
      const rowInfo: XLSX.RowInfo[] = Array.from({ length: headerRow + 1 }, () => ({}));
      rowInfo[headerRow] = { hpt: HEADER_ROW_HEIGHT_PT };
      worksheet['!rows'] = rowInfo;
    }
    if (sheet.table) {
      const range = tableRange(sheet.rows, sheet.table);
      if (range) worksheet['!autofilter'] = { ref: range };
    }
    applyMoneyFormat(worksheet, sheet.rows, headerRow);
    XLSX.utils.book_append_sheet(workbook, worksheet, uniqueSheetName(sheet.name, usedNames));
  }
  const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array;
  return output instanceof Uint8Array ? output : new Uint8Array(output);
}

export { freezeHeaderRows } from './xlsx-freeze';
