// Офлайн-сборка PDF кабельного журнала: pdf-lib + встроенный PT Sans (кириллица).
// Документ A4 landscape, повторяющиеся заголовки таблиц, колонтитулы и отметка неполного расчёта.
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Project } from './model';
import { calculateCable, specifications, validateProject } from './engine';
import type { JournalFonts } from './export-fonts';

const PAGE = { width: 842, height: 595 };
const MARGIN = 34;
const CONTENT = PAGE.width - MARGIN * 2;
const BRAND = rgb(0.07, 0.16, 0.21);
const ACCENT = rgb(0, 0.56, 0.58);
const MUTED = rgb(0.39, 0.46, 0.5);
const BORDER = rgb(0.83, 0.87, 0.88);
const ZEBRA = rgb(0.965, 0.973, 0.976);
const DANGER = rgb(0.86, 0.31, 0.44);
const WHITE = rgb(1, 1, 1);

export const formatNumber = (value: number | null): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
};

interface Column { title: string; width: number; align?: 'left' | 'right' }
interface Section { title: string; note?: string; columns: Column[]; rows: string[][] }

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
    if (this.y - height < MARGIN + 26) this.addPage();
  }

  cover(project: Project): void {
    this.page.drawRectangle({ x: 0, y: PAGE.height - 92, width: PAGE.width, height: 92, color: BRAND });
    this.page.drawText('AnOOPlan', { x: MARGIN, y: PAGE.height - 40, size: 10, font: this.bold, color: ACCENT });
    this.page.drawText(project.name || 'Проект', { x: MARGIN, y: PAGE.height - 72, size: 19, font: this.bold, color: WHITE });
    const summary = `Этажей: ${project.floors.length} · Оборудования: ${project.equipment.length} · Трасс: ${project.routes.length} · Кабелей: ${project.cables.length}`;
    this.page.drawText(`Кабельный журнал · ${summary}`, { x: MARGIN, y: PAGE.height - 108, size: 8.5, font: this.regular, color: MUTED });
    this.page.drawText(`Дата выгрузки: ${new Date().toLocaleString('ru-RU')}`, { x: MARGIN, y: PAGE.height - 120, size: 8.5, font: this.regular, color: MUTED });
    this.y = PAGE.height - 146;
  }

  heading(title: string, note?: string): void {
    this.ensure(56);
    this.page.drawText(title, { x: MARGIN, y: this.y - 16, size: 13.5, font: this.bold, color: BRAND });
    this.y -= 22;
    if (note) {
      const lines = wrapText(note, this.regular, 8.2, CONTENT);
      lines.forEach((line, index) => this.page.drawText(line, { x: MARGIN, y: this.y - 8 - index * 10.5, size: 8.2, font: this.regular, color: MUTED }));
      this.y -= lines.length * 10.5 + 4;
    }
    this.y -= 4;
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
      if (this.y - height < MARGIN + 24) {
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

  finish(): void {
    const total = this.pages.length;
    this.pages.forEach((page, index) => {
      page.drawLine({ start: { x: MARGIN, y: MARGIN + 18 }, end: { x: PAGE.width - MARGIN, y: MARGIN + 18 }, thickness: 0.5, color: BORDER });
      page.drawText('AnOOPlan · кабельный план', { x: MARGIN, y: MARGIN + 6, size: 7.5, font: this.regular, color: MUTED });
      const label = `стр. ${index + 1} из ${total}`;
      const width = this.regular.widthOfTextAtSize(label, 7.5);
      page.drawText(label, { x: PAGE.width - MARGIN - width, y: MARGIN + 6, size: 7.5, font: this.regular, color: MUTED });
    });
  }
}

function buildSections(project: Project): Section[] {
  const specs = specifications(project);
  const equipmentNumber = (id: string) => project.equipment.find(item => item.id === id)?.number || '—';

  const journal = project.cables.map(cable => {
    const result = calculateCable(project, cable);
    return [
      cable.number,
      [cable.name, cable.brand].filter(Boolean).join(' · ') || '—',
      `${equipmentNumber(cable.fromId)} - ${equipmentNumber(cable.toId)}`,
      formatNumber(result.geometry),
      formatNumber(result.routeReserve),
      formatNumber(result.cableReserve),
      formatNumber(result.endReserve),
      formatNumber(result.total),
      String(cable.quantity),
      formatNumber(result.total === null ? null : result.total * cable.quantity),
      result.complete ? 'полный' : 'неполный',
    ];
  });

  return [
    {
      title: 'Кабельный журнал',
      note: 'Длина одного кабеля учитывает геометрию трассы, запасы трасс и кабеля, концевые запасы. Неполные данные помечены и не заменяются нулём.',
      columns: [
        { title: '№', width: 32 },
        { title: 'Кабель / марка', width: 148 },
        { title: 'От - до', width: 74 },
        { title: 'Геометрия, м', width: 56, align: 'right' },
        { title: 'Запас трасс', width: 50, align: 'right' },
        { title: 'Запас кабеля', width: 50, align: 'right' },
        { title: 'Концы', width: 40, align: 'right' },
        { title: 'Итог / шт, м', width: 56, align: 'right' },
        { title: 'Кол.', width: 26, align: 'right' },
        { title: 'Итого, м', width: 56, align: 'right' },
        { title: 'Статус', width: 52 },
      ],
      rows: journal,
    },
    {
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
      title: 'Кабельная инфраструктура',
      columns: [
        { title: 'Тип', width: 220 },
        { title: 'Длина, м', width: 160, align: 'right' },
        { title: 'Сегментов', width: 140, align: 'right' },
        { title: 'Кабелей', width: 140, align: 'right' },
      ],
      rows: specs.infrastructure.map(row => [row.type, formatNumber(row.length), String(row.segments), String(row.cables)]),
    },
  ];
}

export async function buildJournalPdf(project: Project, fonts: JournalFonts): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const regular = await document.embedFont(new Uint8Array(fonts.regular), { subset: true });
  const bold = await document.embedFont(new Uint8Array(fonts.bold), { subset: true });
  document.setTitle(`AnOOPlan — ${project.name}`);
  document.setAuthor('AnOOPlan');
  document.setCreator('AnOOPlan');
  document.setProducer('AnOOPlan');

  const renderer = new Renderer(document, regular, bold);
  renderer.cover(project);

  for (const section of buildSections(project)) {
    renderer.heading(section.title, section.note);
    if (section.rows.length) renderer.table(section.columns, section.rows);
    else renderer.paragraph('Нет записей.', MUTED);
  }

  const warnings = [...new Set([...validateProject(project), ...specifications(project).errors])];
  if (warnings.length) {
    renderer.heading('Замечания и предупреждения', 'Проверьте данные перед применением документации на объекте.');
    renderer.list(warnings);
  }

  renderer.finish();
  return document.save();
}

