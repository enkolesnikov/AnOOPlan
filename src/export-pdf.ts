// Офлайн-сборка PDF кабельного журнала: pdf-lib + встроенный PT Sans (кириллица).
// Документ A4 landscape, повторяющиеся заголовки таблиц, колонтитулы и отметка неполного расчёта.
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Cable, Project } from './model';
import { cableSection, calculateCable, domainWarnings, specifications, validateProject } from './engine';
import { estimate } from './estimate';
import type { JournalFonts } from './export-fonts';

export interface JournalPhoto { number: string; name: string; data: ArrayBuffer; mime: string }
export interface JournalPlan { title: string; png: Uint8Array; note?: string }

/** Раздел печатной формы; `include` в {@link JournalOptions} фильтрует их набор. */
export type JournalSectionId =
  | 'journal'
  | 'equipment'
  | 'cables'
  | 'routeScheme'
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

export interface JournalOptions {
  photos?: JournalPhoto[];
  pinPhotos?: JournalPhoto[];
  plans?: JournalPlan[];
  /** Какие разделы печатать; `undefined` — все ({@link DEFAULT_JOURNAL_SECTIONS}). */
  include?: JournalSectionId[];
}

const PAGE = { width: 842, height: 595 };
const MARGIN = 34;
const CONTENT = PAGE.width - MARGIN * 2;
const BRAND = rgb(0.07, 0.16, 0.21);
const MUTED = rgb(0.39, 0.46, 0.5);
const BORDER = rgb(0.83, 0.87, 0.88);
const ZEBRA = rgb(0.965, 0.973, 0.976);
const DANGER = rgb(0.86, 0.31, 0.44);
const WHITE = rgb(1, 1, 1);

/**
 * Упрощённая основная надпись по ГОСТ 2.104 внизу справа. Контент на страницах
 * со штампом заканчивается выше него, чтобы таблицы и текст не накладывались.
 */
const STAMP = { width: 330, height: 84, bottom: 24 };
const STAMP_LEFT = PAGE.width - MARGIN - STAMP.width;
const STAMP_TOP = STAMP.bottom + STAMP.height;
const CONTENT_BOTTOM = STAMP_TOP + 8;


export const formatNumber = (value: number | null): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
};

/** Внешний диаметр кабеля: незаданное значение не подменяется нулём. */
const cableDiameter = (cable: Cable): number | null => {
  const value = cable.outerDiameterMm;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

interface Column { title: string; width: number; align?: 'left' | 'right' }
interface Section { id: JournalSectionId; title: string; note?: string; columns: Column[]; rows: string[][]; emptyText?: string; footer?: string }
interface TocEntry { title: string; page: number }

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
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
function fitText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) result = result.slice(0, -1);
  return `${result}…`;
}

class Renderer {
  page!: PDFPage;
  y = 0;
  readonly pages: PDFPage[] = [];

  constructor(private readonly document: PDFDocument, private readonly regular: PDFFont, private readonly bold: PDFFont) {
    this.addPage();
  }

  addPage(): PDFPage {
    this.page = this.document.addPage([PAGE.width, PAGE.height]);
    this.pages.push(this.page);
    this.y = PAGE.height - MARGIN;
    return this.page;
  }

  ensure(height: number): void {
    if (this.y - height < CONTENT_BOTTOM) this.addPage();
  }

  /** Титульный лист (страница 1): рамку и колонтитул дорисует finish(). */
  titlePage(project: Project): void {
    const document = project.document ?? {};
    const page = this.page;
    const center = (content: string, y: number, size: number, font: PDFFont, color = BRAND): void => {
      const width = font.widthOfTextAtSize(content, size);
      page.drawText(content, { x: Math.max(MARGIN, (PAGE.width - width) / 2), y, size, font, color });
    };
    const documentTitle = (document.title ?? '').trim() || 'Кабельный журнал и смета';
    const organization = (document.organization ?? '').trim();
    const object = (document.object ?? '').trim();
    const code = (document.documentCode ?? '').trim();
    const city = (document.city ?? '').trim();
    const date = (document.date ?? '').trim();
    const compiledBy = (document.compiledBy ?? '').trim();
    const checkedBy = (document.checkedBy ?? '').trim();

    if (organization) center(organization, PAGE.height - 92, 13, this.bold);
    center(`Проект: ${project.name || 'Без названия'}`, PAGE.height - 118, 9.5, this.regular, MUTED);

    const titleLines = wrapText(documentTitle, this.bold, 24, CONTENT);
    titleLines.forEach((line, index) => center(line, PAGE.height - 250 - index * 30, 24, this.bold));
    let y = PAGE.height - 250 - titleLines.length * 30 - 10;
    if (object) {
      for (const line of wrapText(`Объект: ${object}`, this.regular, 11.5, CONTENT)) {
        center(line, y, 11.5, this.regular);
        y -= 16;
      }
    }
    if (code) center(`Шифр: ${code}`, Math.min(y - 6, PAGE.height - 330), 11, this.bold);
    y = Math.min(y - 28, PAGE.height - 360);

    const signature = (label: string, value: string, lineY: number): void => {
      page.drawText(`${label}:`, { x: MARGIN + 110, y: lineY, size: 10.5, font: this.bold, color: BRAND });
      const lineStart = MARGIN + 190;
      const lineEnd = PAGE.width - MARGIN - 150;
      page.drawLine({ start: { x: lineStart, y: lineY - 2 }, end: { x: lineEnd, y: lineY - 2 }, thickness: 0.6, color: MUTED });
      if (value) page.drawText(value, { x: lineStart + 6, y: lineY, size: 10, font: this.regular, color: BRAND });
      page.drawText('подпись', { x: lineEnd + 8, y: lineY - 1, size: 7.5, font: this.regular, color: MUTED });
    };
    signature('Составил', compiledBy, y);
    signature('Проверил', checkedBy, y - 28);
    if (date) center(`Дата: ${date}`, y - 68, 10, this.regular);
    const year = /^\d{4}/.test(date) ? date.slice(0, 4) : String(new Date().getFullYear());
    center(city ? `${city} · ${year}` : year, PAGE.height - 500, 11, this.regular);
  }

  /** Заголовок раздела; возвращает фактический номер страницы, где он начинается. */
  heading(title: string, note?: string): number {
    this.ensure(56);
    const page = this.pages.length;
    this.page.drawText(title, { x: MARGIN, y: this.y - 16, size: 13.5, font: this.bold, color: BRAND });
    this.y -= 22;
    if (note) {
      const lines = wrapText(note, this.regular, 8.2, CONTENT);
      lines.forEach((line, index) => this.page.drawText(line, { x: MARGIN, y: this.y - 8 - index * 10.5, size: 8.2, font: this.regular, color: MUTED }));
      this.y -= lines.length * 10.5 + 4;
    }
    this.y -= 4;
    return page;
  }

  paragraph(text: string, color = BRAND): void {
    const size = 8.6;
    const lines = wrapText(text, this.regular, size, CONTENT);
    this.ensure(lines.length * (size + 3) + 8);
    lines.forEach((line, index) => this.page.drawText(line, { x: MARGIN, y: this.y - size - index * (size + 3), size, font: this.regular, color }));
    this.y -= lines.length * (size + 3) + 6;
  }

  list(items: string[]): void {
    for (const item of items) this.paragraph(`• ${item}`, DANGER);
  }

  table(columns: Column[], rows: string[][]): void {
    const scale = CONTENT / columns.reduce((sum, column) => sum + column.width, 0);
    const widths = columns.map(column => column.width * scale);
    const size = 7.6;
    const lineHeight = size + 2.6;
    const padding = 4;
    const headerHeight = 18;

    const drawHeader = () => {
      this.page.drawRectangle({ x: MARGIN, y: this.y - headerHeight, width: CONTENT, height: headerHeight, color: BRAND });
      let x = MARGIN;
      columns.forEach((column, index) => {
        this.page.drawText(column.title, { x: x + padding, y: this.y - headerHeight + 6, size: 7.4, font: this.bold, color: WHITE });
        x += widths[index];
      });
      this.y -= headerHeight;
    };

    this.ensure(headerHeight + 30);
    drawHeader();

    rows.forEach((row, rowIndex) => {
      const cells = row.map((value, index) => wrapText(value, this.regular, size, widths[index] - padding * 2));
      const lineCount = Math.max(1, ...cells.map(lines => lines.length));
      const height = lineCount * lineHeight + padding * 1.4;
      if (this.y - height < CONTENT_BOTTOM) {
        this.addPage();
        drawHeader();
      }
      if (rowIndex % 2 === 1) {
        this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: CONTENT, height, color: ZEBRA });
      }
      let x = MARGIN;
      cells.forEach((lines, index) => {
        const column = columns[index];
        const color = String(row[index]).toLowerCase().includes('неполный') ? DANGER : BRAND;
        lines.forEach((line, lineIndex) => {
          const textWidth = this.regular.widthOfTextAtSize(line, size);
          const drawX = column.align === 'right' ? x + widths[index] - padding - textWidth : x + padding;
          this.page.drawText(line, { x: drawX, y: this.y - padding - size - lineIndex * lineHeight + 2, size, font: this.regular, color });
        });
        x += widths[index];
      });
      this.page.drawLine({ start: { x: MARGIN, y: this.y - height }, end: { x: MARGIN + CONTENT, y: this.y - height }, thickness: 0.5, color: BORDER });
      this.y -= height;
    });
    this.y -= 14;
  }

  totals(project: Project): void {
    let meters = 0;
    let metersComplete = true;
    let cost = 0;
    let costComplete = true;
    for (const cable of project.cables) {
      const result = calculateCable(project, cable);
      if (result.total === null) metersComplete = false;
      else meters += result.total * cable.quantity;
      if (result.cost === null) costComplete = false;
      else cost += result.cost;
    }
    const parts = [
      metersComplete ? `Итого кабеля по журналу: ${formatNumber(meters)} м` : 'Итого кабеля по журналу: рассчитано не полностью',
      costComplete && project.cables.length ? `стоимость: ${formatNumber(cost)} ₽` : 'стоимость: цены заданы не для всех кабелей',
    ];
    this.ensure(40);
    this.page.drawRectangle({ x: MARGIN, y: this.y - 22, width: CONTENT, height: 22, color: ZEBRA });
    this.page.drawText(parts.join(' · '), { x: MARGIN + 8, y: this.y - 15, size: 8.6, font: this.bold, color: BRAND });
    this.y -= 30;
  }

  signatures(project: Project): void {
    const compiledBy = (project.document?.compiledBy || '').trim();
    const checkedBy = (project.document?.checkedBy || '').trim();
    const date = (project.document?.date || '').trim() || new Date().toLocaleDateString('ru-RU');
    this.ensure(96);
    this.y -= 6;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: MARGIN + CONTENT, y: this.y }, thickness: 0.8, color: BORDER });
    this.y -= 22;
    const rows: { label: string; value: string }[] = [
      { label: 'Составил', value: compiledBy },
      { label: 'Проверил', value: checkedBy },
    ];
    for (const row of rows) {
      this.page.drawText(`${row.label}:`, { x: MARGIN, y: this.y, size: 9, font: this.bold, color: BRAND });
      const lineStart = MARGIN + 70;
      const lineEnd = MARGIN + CONTENT - 160;
      this.page.drawLine({ start: { x: lineStart, y: this.y - 2 }, end: { x: lineEnd, y: this.y - 2 }, thickness: 0.6, color: MUTED });
      if (row.value) this.page.drawText(row.value, { x: lineStart + 6, y: this.y, size: 9, font: this.regular, color: BRAND });
      this.page.drawText('подпись', { x: lineEnd + 6, y: this.y, size: 7.5, font: this.regular, color: MUTED });
      this.y -= 26;
    }
    this.page.drawText(`Дата: ${date}`, { x: MARGIN, y: this.y, size: 9, font: this.regular, color: BRAND });
    this.page.drawText('Документ сформирован в AnOOPlan', { x: MARGIN + CONTENT - 170, y: this.y, size: 7.5, font: this.regular, color: MUTED });
    this.y -= 18;
  }

  /** Фотографии; возвращает номер страницы заголовка или null, если снимков нет. */
  async photos(items: JournalPhoto[], title = 'Фотографии оборудования'): Promise<number | null> {
    if (!items.length) return null;
    const page = this.heading(title, `Снимков в проекте: ${items.length}. Форматы: JPEG и PNG.`);
    const gap = 16;
    const cellWidth = (CONTENT - gap) / 2;
    const imageHeight = 200;
    const captionHeight = 22;
    for (let index = 0; index < items.length; index += 2) {
      const row = items.slice(index, index + 2);
      this.ensure(imageHeight + captionHeight + 12);
      for (let column = 0; column < row.length; column += 1) {
        const item = row[column];
        const x = MARGIN + column * (cellWidth + gap);
        const top = this.y;
        try {
          const bytes = new Uint8Array(item.data);
          const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
          const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
          if (!isPng && !isJpeg) throw new Error('формат не поддерживается');
          const image = isPng ? await this.document.embedPng(bytes) : await this.document.embedJpg(bytes);
          const scale = Math.min(cellWidth / image.width, imageHeight / image.height);
          const width = image.width * scale;
          const height = image.height * scale;
          this.page.drawImage(image, { x: x + (cellWidth - width) / 2, y: top - height, width, height });
        } catch {
          this.page.drawText('Фото не встроено: нужен JPEG или PNG', { x: x + 4, y: top - 20, size: 8, font: this.regular, color: DANGER });
        }
        const caption = `${item.number} · ${item.name}`;
        this.page.drawText(caption.length > 78 ? `${caption.slice(0, 75)}…` : caption, { x, y: top - imageHeight - 12, size: 8, font: this.regular, color: BRAND });
      }
      this.y -= imageHeight + captionHeight + 10;
    }
    return page;
  }

  /** Планы этажей; возвращает записи оглавления (по одной на план). */
  async plans(items: JournalPlan[]): Promise<TocEntry[]> {
    const entries: TocEntry[] = [];
    for (const item of items) {
      // Заголовок и изображение должны попасть на один лист: иначе план уезжает на следующую
      // страницу, а заголовок остаётся сиротой внизу предыдущей.
      this.ensure(440);
      const title = `План: ${item.title}`;
      const page = this.heading(title, 'Подложка этажа и нанесённые трассы с оборудованием — лист для подписи.');
      entries.push({ title, page });
      if (item.note) this.paragraph(item.note, DANGER);
      try {
        const image = await this.document.embedPng(item.png);
        const maxHeight = 380;
        const scale = Math.min(CONTENT / image.width, maxHeight / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        this.ensure(height + 16);
        this.page.drawImage(image, { x: MARGIN + (CONTENT - width) / 2, y: this.y - height, width, height });
        this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: CONTENT, height, borderColor: BORDER, borderWidth: 0.6 });
        this.y -= height + 18;
      } catch {
        this.paragraph('План не встроен: не удалось подготовить изображение.', DANGER);
      }
    }
    return entries;
  }

  /** Оглавление: рисуется в конце, когда известны фактические страницы разделов. */
  drawContents(page: PDFPage, entries: TocEntry[]): void {
    page.drawText('Оглавление', { x: MARGIN, y: PAGE.height - MARGIN - 22, size: 16, font: this.bold, color: BRAND });
    page.drawLine({ start: { x: MARGIN, y: PAGE.height - MARGIN - 34 }, end: { x: PAGE.width - MARGIN, y: PAGE.height - MARGIN - 34 }, thickness: 0.8, color: BORDER });
    const size = 10.5;
    let y = PAGE.height - MARGIN - 64;
    for (let index = 0; index < entries.length; index += 1) {
      if (y < CONTENT_BOTTOM + 20) {
        // Оглавление не переносится: при большом числе планов показываем остаток одной строкой.
        page.drawText(`…ещё разделов: ${entries.length - index}`, { x: MARGIN, y, size: 9, font: this.regular, color: MUTED });
        break;
      }
      const entry = entries[index];
      page.drawText(entry.title, { x: MARGIN, y, size, font: this.regular, color: BRAND });
      const numberText = String(entry.page);
      const numberWidth = this.regular.widthOfTextAtSize(numberText, size);
      page.drawText(numberText, { x: PAGE.width - MARGIN - numberWidth, y, size, font: this.regular, color: BRAND });
      const titleWidth = this.regular.widthOfTextAtSize(entry.title, size);
      page.drawLine({ start: { x: MARGIN + titleWidth + 8, y: y + 3 }, end: { x: PAGE.width - MARGIN - numberWidth - 8, y: y + 3 }, thickness: 0.4, color: BORDER });
      y -= 23;
    }
    if (!entries.length) page.drawText('Разделы не выбраны.', { x: MARGIN, y, size, font: this.regular, color: MUTED });
  }

  /**
   * Упрощённая основная надпись по ГОСТ 2.104: подписи, название/шифр/организация,
   * «Лист N» и «Листов M». Рисуется на всех листах, кроме титульного.
   */
  private stamp(page: PDFPage, project: Project, sheet: number, sheets: number): void {
    const document = project.document ?? {};
    const x0 = STAMP_LEFT;
    const x1 = PAGE.width - MARGIN;
    const y0 = STAMP.bottom;
    const y1 = STAMP_TOP;
    const middleX = x0 + 165;
    const line = (start: { x: number; y: number }, end: { x: number; y: number }, thickness = 0.4): void =>
      page.drawLine({ start, end, thickness, color: BRAND });
    page.drawRectangle({ x: x0, y: y0, width: STAMP.width, height: STAMP.height, borderColor: BRAND, borderWidth: 0.6 });
    line({ x: middleX, y: y0 }, { x: middleX, y: y1 });

    const signatureRows: [string, string][] = [
      ['Разраб.', (document.compiledBy ?? '').trim() || '—'],
      ['Пров.', (document.checkedBy ?? '').trim() || '—'],
      ['Т.контр.', '—'],
      ['Н.контр.', '—'],
      ['Утв.', '—'],
    ];
    const rowHeight = STAMP.height / signatureRows.length;
    signatureRows.forEach(([label, value], index) => {
      const top = y1 - index * rowHeight;
      const baseline = top - rowHeight + 5;
      if (index > 0) line({ x: x0, y: top }, { x: middleX, y: top });
      page.drawText(label, { x: x0 + 3, y: baseline, size: 6.5, font: this.bold, color: BRAND });
      page.drawText(fitText(value, this.regular, 6.5, middleX - x0 - 78), { x: x0 + 74, y: baseline, size: 6.5, font: this.regular, color: BRAND });
    });

    // Шапка правой части: «Изм.», «Лист», «№ докум.», «Подп.», «Дата».
    const headerLabels = ['Изм.', 'Лист', '№ докум.', 'Подп.', 'Дата'];
    const headerWidths = [25, 25, 52, 30, 33];
    const headerBottom = y1 - 14;
    line({ x: middleX, y: headerBottom }, { x: x1, y: headerBottom });
    let cursor = middleX;
    headerLabels.forEach((label, index) => {
      if (index > 0) line({ x: cursor, y: headerBottom }, { x: cursor, y: y1 });
      page.drawText(label, { x: cursor + 2, y: headerBottom + 4.5, size: 5.8, font: this.regular, color: BRAND });
      cursor += headerWidths[index];
    });

    const rightRowHeight = (headerBottom - y0) / 4;
    const rightRows: { text: string; bold: boolean }[] = [
      { text: fitText((document.title ?? '').trim() || 'Кабельный журнал и смета', this.bold, 7, x1 - middleX - 8), bold: true },
      { text: fitText((document.documentCode ?? '').trim() || '—', this.regular, 6.5, x1 - middleX - 8), bold: false },
      { text: fitText((document.organization ?? '').trim() || '—', this.regular, 6.5, x1 - middleX - 8), bold: false },
    ];
    rightRows.forEach((row, index) => {
      const top = headerBottom - index * rightRowHeight;
      line({ x: middleX, y: top }, { x: x1, y: top });
      page.drawText(row.text, { x: middleX + 4, y: top - rightRowHeight + 5.5, size: row.bold ? 7 : 6.5, font: row.bold ? this.bold : this.regular, color: BRAND });
    });
    const sheetTop = headerBottom - rightRows.length * rightRowHeight;
    line({ x: middleX, y: sheetTop }, { x: x1, y: sheetTop });
    line({ x: middleX + 82, y: y0 }, { x: middleX + 82, y: sheetTop });
    page.drawText(`Лист ${sheet}`, { x: middleX + 4, y: y0 + 4.5, size: 6.5, font: this.bold, color: BRAND });
    page.drawText(`Листов ${sheets}`, { x: middleX + 90, y: y0 + 4.5, size: 6.5, font: this.regular, color: BRAND });
  }

  finish(project?: Project): void {
    const total = this.pages.length;
    const today = new Date().toLocaleDateString('ru-RU');
    this.pages.forEach((page, index) => {
      const titlePage = index === 0;
      // Рамка листа и колонтитул с названием проекта — документ можно подписывать постранично.
      page.drawRectangle({ x: 18, y: 18, width: PAGE.width - 36, height: PAGE.height - 36, borderColor: BRAND, borderWidth: 0.8 });
      const footerEnd = titlePage ? PAGE.width - MARGIN : STAMP_LEFT - 8;
      page.drawLine({ start: { x: MARGIN, y: MARGIN + 18 }, end: { x: footerEnd, y: MARGIN + 18 }, thickness: 0.5, color: BORDER });
      const title = fitText(project ? `AnOOPlan · ${project.name}` : 'AnOOPlan · кабельный план', this.regular, 7.5, 240);
      page.drawText(title, { x: MARGIN, y: MARGIN + 6, size: 7.5, font: this.regular, color: MUTED });
      const middle = `Кабельный журнал · ${today}`;
      const middleWidth = this.regular.widthOfTextAtSize(middle, 7.5);
      page.drawText(middle, { x: titlePage ? (PAGE.width - middleWidth) / 2 : MARGIN + 250, y: MARGIN + 6, size: 7.5, font: this.regular, color: MUTED });
      if (titlePage) {
        const label = `Лист ${index + 1} из ${total}`;
        const width = this.regular.widthOfTextAtSize(label, 7.5);
        page.drawText(label, { x: PAGE.width - MARGIN - width, y: MARGIN + 6, size: 7.5, font: this.regular, color: MUTED });
      } else if (project) {
        this.stamp(page, project, index + 1, total);
      }
    });
  }
}

type EstimateResult = ReturnType<typeof estimate>;

/** Подпись строки работ: «Работы (25 %)»; без заданного процента — «Работы (не задан)», а не 0. */
const laborLabel = (percent: number | null): string => (percent === null ? 'Работы (не задан)' : `Работы (${formatNumber(percent)} %)`);

function buildSections(project: Project, estimateResult: EstimateResult): Section[] {
  const specs = specifications(project);
  const equipmentNumber = (id: string) => project.equipment.find(item => item.id === id)?.number || '—';

  const journal = project.cables.map(cable => {
    const result = calculateCable(project, cable);
    const section = cableSection(cable);
    return [
      cable.number,
      [cable.name, cable.brand].filter(Boolean).join(' · ') || '—',
      formatNumber(cableDiameter(cable)),
      formatNumber(section.areaMm2),
      `${equipmentNumber(cable.fromId)} - ${equipmentNumber(cable.toId)}`,
      formatNumber(result.geometry),
      formatNumber(result.routeReserve),
      formatNumber(result.cableReserve),
      formatNumber(result.endReserve),
      formatNumber(result.total),
      String(cable.quantity),
      formatNumber(result.total === null ? null : result.total * cable.quantity),
      formatNumber(result.pricePerMeter),
      formatNumber(result.cost),
      result.complete ? 'полный' : 'неполный',
    ];
  });

  return [
    {
      id: 'journal',
      title: 'Кабельный журнал',
      note: 'Длина одного кабеля учитывает геометрию трассы, запасы трасс и кабеля, концевые запасы. Неполные данные помечены и не заменяются нулём.',
      columns: [
        { title: '№', width: 32 },
        { title: 'Кабель / марка', width: 148 },
        { title: 'Ø, мм', width: 36, align: 'right' },
        { title: 'S, мм²', width: 44, align: 'right' },
        { title: 'От - до', width: 74 },
        { title: 'Геометрия, м', width: 56, align: 'right' },
        { title: 'Запас трасс', width: 50, align: 'right' },
        { title: 'Запас кабеля', width: 50, align: 'right' },
        { title: 'Концы', width: 40, align: 'right' },
        { title: 'Итог / шт, м', width: 56, align: 'right' },
        { title: 'Кол.', width: 26, align: 'right' },
        { title: 'Итого, м', width: 56, align: 'right' },
        { title: 'Цена, ₽/м', width: 52, align: 'right' },
        { title: 'Стоимость, ₽', width: 58, align: 'right' },
        { title: 'Статус', width: 52 },
      ],
      rows: journal,
    },
    {
      id: 'equipment',
      title: 'Оборудование',
      columns: [
        { title: 'Тип', width: 200 },
        { title: 'Модель', width: 200 },
        { title: 'Этаж', width: 200 },
        { title: 'Количество', width: 100, align: 'right' },
      ],
      rows: specs.equipment.map(row => [row.type, row.model, row.floor, String(row.quantity)]),
    },
    {
      id: 'cables',
      title: 'Кабельная продукция',
      columns: [
        { title: 'Марка', width: 240 },
        { title: 'Количество линий', width: 150, align: 'right' },
        { title: 'Геометрия, м', width: 160, align: 'right' },
        { title: 'Итого, м', width: 160, align: 'right' },
      ],
      rows: specs.cables.map(row => [row.brand, String(row.lines), formatNumber(row.geometry), formatNumber(row.total)]),
    },
    {
      id: 'routeScheme',
      title: 'Схема трасс',
      note: 'Метраж трасс по типам КНС (включая гофру) и количество углов кабельных каналов/коробов. Фитинги и крепления не считаются.',
      columns: [
        { title: 'Трасса', width: 50 },
        { title: 'Тип КНС', width: 140 },
        { title: 'Длина, м', width: 80, align: 'right' },
        { title: 'Сегментов', width: 70, align: 'right' },
        { title: 'Углы', width: 50, align: 'right' },
      ],
      rows: specs.routeSummary.routes.map(row => [
        row.number,
        row.type || '—',
        formatNumber(row.length),
        String(row.segments),
        row.group === 'Кабель-канал' ? String(row.angles.total) : '—',
      ]),
      emptyText: 'Трасс нет.',
      footer: specs.routeSummary.groups.length
        ? `Итого по типам: ${specs.routeSummary.groups.map(group => `${group.group} — ${formatNumber(group.length)} м${group.group === 'Кабель-канал' ? `, углов ${group.angles.total}` : ''}`).join('; ')}.`
        : undefined,
    },
    {
      id: 'infrastructure',
      title: 'Кабельная инфраструктура',
      columns: [
        { title: 'Тип', width: 180 },
        { title: 'Длина, м', width: 120, align: 'right' },
        { title: 'Сегментов', width: 110, align: 'right' },
        { title: 'Кабелей', width: 100, align: 'right' },
        { title: 'Макс. заполнение, %', width: 130, align: 'right' },
        { title: 'Сегментов с превышением', width: 150, align: 'right' },
      ],
      rows: specs.infrastructure.map(row => [row.type, formatNumber(row.length), String(row.segments), String(row.cables), formatNumber(row.maxFillPercent), String(row.overSegments)]),
    },
    {
      id: 'trayFill',
      title: 'Заполнение КНС',
      note: 'Заполнение — отношение площади сечения кабелей к площади КНС (лоток, короб, труба, гофра). Внимание выше 40 %, превышение выше 50 %. «Неполный» означает, что сечение не задано и не заменено нулём.',
      columns: [
        { title: 'Трасса', width: 44 },
        { title: 'Сегмент', width: 56 },
        { title: 'КНС, мм', width: 72 },
        { title: 'Площадь КНС, мм²', width: 84, align: 'right' },
        { title: 'Линий', width: 40, align: 'right' },
        { title: 'Площадь кабелей, мм²', width: 90, align: 'right' },
        { title: 'Заполнение, %', width: 80, align: 'right' },
        { title: 'Статус', width: 80 },
      ],
      rows: specs.trayFill.map(row => [
        row.route,
        row.segment,
        row.tray || '—',
        formatNumber(row.trayAreaMm2),
        String(row.lines),
        formatNumber(row.areaMm2),
        formatNumber(row.fillPercent),
        row.status,
      ]),
    },
    {
      id: 'estimate',
      title: 'Смета',
      note: `Дата прайса: ${estimateResult.catalogDate ?? '—'}. Неизвестные значения показаны как «—» и не заменяются нулём.`,
      columns: [
        { title: 'Раздел', width: 110 },
        { title: 'Позиция', width: 190 },
        { title: 'Ед.', width: 40 },
        { title: 'Количество', width: 60, align: 'right' },
        { title: 'Цена, ₽', width: 70, align: 'right' },
        { title: 'Сумма, ₽', width: 80, align: 'right' },
      ],
      rows: [
        ...estimateResult.sections.filter(section => section.kind !== 'work').flatMap(section => [
          ...section.lines.map(line => [
            section.title,
            line.name || '—',
            line.unit || '—',
            formatNumber(line.quantity),
            formatNumber(line.price),
            formatNumber(line.total),
          ]),
          ['', `Итого: ${section.title}`, '', '', '', formatNumber(section.total)],
        ]),
        ['', 'Итого материалы', '', '', '', formatNumber(estimateResult.materials)],
        ['', laborLabel(estimateResult.laborPercent), '', '', '', formatNumber(estimateResult.labor)],
        ['', 'Итого по смете', '', '', '', formatNumber(estimateResult.total)],
      ],
    },
    {
      id: 'commercial',
      title: 'Коммерческое предложение',
      note: [
        `Дата прайса: ${estimateResult.catalogDate ?? '—'}`,
        project.estimate?.note ? `Примечание: ${project.estimate.note}` : '',
        'Цены без НДС. Неизвестные значения не заменяются нулём.',
      ].filter(Boolean).join(' · '),
      columns: [
        { title: 'Раздел', width: 220 },
        { title: 'Сумма, ₽', width: 120, align: 'right' },
      ],
      rows: [
        ...estimateResult.sections.filter(section => section.kind !== 'work').map(section => [section.title, formatNumber(section.total)]),
        ['Итого материалы', formatNumber(estimateResult.materials)],
        [laborLabel(estimateResult.laborPercent), formatNumber(estimateResult.labor)],
        ['Итого', formatNumber(estimateResult.total)],
      ],
    },
    {
      id: 'pins',
      title: 'Замечания',
      note: 'Пины-замечания по этажам. Статус «закрыто» означает, что замечание отработано.',
      columns: [
        { title: '№', width: 44 },
        { title: 'Этаж', width: 150 },
        { title: 'X', width: 70, align: 'right' },
        { title: 'Y', width: 70, align: 'right' },
        { title: 'Замечание', width: 286 },
        { title: 'Статус', width: 90 },
      ],
      rows: (project.pins ?? []).map(pin => [
        pin.number,
        project.floors.find(floor => floor.id === pin.floorId)?.name || '—',
        formatNumber(pin.x),
        formatNumber(pin.y),
        pin.comment || '—',
        pin.status === 'closed' ? 'закрыто' : 'открыто',
      ]),
    },
    {
      id: 'changeLog',
      title: 'Лист регистрации изменений',
      note: 'Записи о редакциях документа: изм., содержание, дата и автор.',
      emptyText: 'Изменений нет.',
      columns: [
        { title: 'Изм.', width: 50 },
        { title: 'Лист/раздел', width: 90 },
        { title: 'Содержание', width: 330 },
        { title: 'Дата', width: 110 },
        { title: 'ФИО', width: 120 },
      ],
      rows: (project.document?.changeLog ?? []).map(entry => [
        entry.version || '—',
        '—',
        entry.description || '—',
        entry.date || '—',
        entry.author || '—',
      ]),
    },
  ];
}

export async function buildJournalPdf(project: Project, fonts: JournalFonts, options: JournalOptions = {}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const regular = await document.embedFont(new Uint8Array(fonts.regular), { subset: true });
  const bold = await document.embedFont(new Uint8Array(fonts.bold), { subset: true });
  document.setTitle(`AnOOPlan — ${project.name}`);
  document.setAuthor('AnOOPlan');
  document.setCreator('AnOOPlan');
  document.setProducer('AnOOPlan');

  const renderer = new Renderer(document, regular, bold);
  // Титульный лист (страница 1) и оглавление (страница 2) выводятся всегда.
  renderer.titlePage(project);
  const contentsPage = renderer.addPage();
  renderer.addPage();
  const toc: TocEntry[] = [];

  const estimateResult = estimate(project);
  const include = new Set<JournalSectionId>(options.include ?? DEFAULT_JOURNAL_SECTIONS);
  for (const section of buildSections(project, estimateResult)) {
    if (!include.has(section.id)) continue;
    // Заголовок раздела не должен оставаться один внизу страницы: оставляем место
    // хотя бы под шапку таблицы и пару строк.
    if (section.rows.length) renderer.ensure(120);
    const page = renderer.heading(section.title, section.note);
    toc.push({ title: section.title, page });
    if (section.rows.length) renderer.table(section.columns, section.rows);
    else renderer.paragraph(section.emptyText ?? 'Нет записей.', MUTED);
    if (section.footer) renderer.paragraph(section.footer, MUTED);
  }

  if (include.has('plans') && options.plans?.length) toc.push(...await renderer.plans(options.plans));
  if (include.has('photos') && options.photos?.length) {
    const page = await renderer.photos(options.photos);
    if (page !== null) toc.push({ title: 'Фотографии оборудования', page });
  }
  if (include.has('pinPhotos') && options.pinPhotos?.length) {
    const page = await renderer.photos(options.pinPhotos, 'Фотографии замечаний');
    if (page !== null) toc.push({ title: 'Фотографии замечаний', page });
  }

  if (include.has('warnings')) {
    const warnings = [...new Set([...validateProject(project), ...domainWarnings(project), ...specifications(project).errors, ...estimateResult.warnings])];
    if (warnings.length) {
      const page = renderer.heading('Замечания и предупреждения', 'Проверьте данные перед применением документации на объекте.');
      toc.push({ title: 'Замечания и предупреждения', page });
      renderer.list(warnings);
    }
  }

  renderer.totals(project);
  renderer.signatures(project);
  renderer.drawContents(contentsPage, toc);
  renderer.finish(project);
  return document.save();
}

