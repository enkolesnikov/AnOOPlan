import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import type { Project } from '../src/model.js';
import { exportSheets } from '../src/sheets.js';
import type { Cell, ExportSheet } from '../src/sheets.js';
import { ApiError } from './validation.js';

export { exportSheets } from '../src/sheets.js';
export type { Cell, ExportSheet } from '../src/sheets.js';

function csvCell(cell: Cell): string {
  let value = cell === null ? '' : String(cell);
  // Spreadsheet formula injection is prevented for user-entered text.
  if (typeof cell === 'string' && /^[=+\-@\t\r]/.test(value)) value = `'${value}`;
  return `"${value.replaceAll('"', '""')}"`;
}
export function csv(sheets: ExportSheet[]): Buffer {
  return Buffer.from('\uFEFF' + sheets.map(s => [[s.name], ...s.rows].map(row => row.map(csvCell).join(';')).join('\r\n')).join('\r\n\r\n'), 'utf8');
}
export function xlsx(sheets: ExportSheet[]): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
export const fontCandidates = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
  '/system/fonts/Roboto-Regular.ttf',
  '/system/fonts/NotoSans-Regular.ttf',
];
/** PDF export requires a system TTF supporting Cyrillic; no silent broken glyphs. */
export function pdf(project: Project, sheets: ExportSheet[]): Promise<Buffer> {
  const font = [process.env.PDF_FONT_PATH, ...fontCandidates].find((path): path is string => !!path && existsSync(path));
  if (!font) throw new ApiError(503, 'Для PDF требуется системный TTF-шрифт с кириллицей. Установите DejaVu Sans или задайте PDF_FONT_PATH. CSV и XLSX доступны.');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    try {
      doc.font(font).fontSize(16).text(project.name || 'Проект');
      doc.fontSize(9).text(`Дата экспорта: ${new Date().toISOString()}`);
      for (const sheet of sheets) {
        doc.addPage(); doc.fontSize(15).text(sheet.name); doc.moveDown(0.5);
        // Vertical records retain all journal fields on readable PDF pages.
        const [headers, ...rows] = sheet.rows;
        if (!rows.length) doc.fontSize(10).text('Нет записей');
        for (const row of rows) {
          doc.fontSize(9).text(row.map((value, i) => `${headers[i]}: ${value === null ? 'не определено' : value}`).join('  |  '), { width: 780 });
          doc.moveDown(0.7);
        }
      }
      doc.end();
    } catch (error) { reject(error); }
  });
}
