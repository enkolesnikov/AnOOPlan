// Офлайн-выгрузка в Excel: тот же набор листов, что отдаёт сервер.
import * as XLSX from 'xlsx';
import type { ExportSheet } from './sheets';

export function buildWorkbook(sheets: ExportSheet[]): Uint8Array {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    // Excel ограничивает имена листов 31 символом.
    const name = sheet.name.slice(0, 31);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), name);
  }
  const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array;
  return output instanceof Uint8Array ? output : new Uint8Array(output);
}
