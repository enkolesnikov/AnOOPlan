// Рендерер листа: титул, таблицы с переносом между листами, фото, планы,
// оглавление, штамп ГОСТ 2.104 (форма 2), рамка и колонтитул.
// Все данные разделов готовит pdf-sections.ts; здесь только отрисовка.
import type { PDFDocument, PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import type { Project } from '../model';
import { calculateCable } from '../engine';
import { normalizeRounding, roundMoney } from '../estimate';
import {
  BORDER,
  BRAND,
  DANGER,
  MUTED,
  PAGE_SIZES,
  STAMP_HEIGHT,
  STAMP_WIDTH,
  WHITE,
  ZEBRA,
  fitText,
  formatDateRu,
  formatMoney,
  formatNumber,
  rowBold,
  rowCells,
  rowZebra,
  wrapText,
  type Column,
  type JournalFormat,
  type JournalPhoto,
  type JournalPlan,
  type TableRow,
  type TocEntry,
} from './pdf-model';

export class Renderer {
  page!: PDFPage;
  y = 0;
  readonly pages: PDFPage[] = [];
  /** Размеры листа конкретного формата: ничего не остаётся глобальной константой. */
  readonly width: number;
  readonly height: number;
  /** Ширина контентной области между полями. */
  readonly content: number;
  /** Поля листа и отступ внутренней рамки — поля экземпляра, а не глобальные константы. */
  readonly margin = 34;
  readonly frame = 18;
  /** Основная надпись прижата к правому нижнему углу внутренней рамки. */
  readonly stamp: { width: number; height: number; left: number; bottom: number; top: number };
  /** Левая часть штампа (5 строк подписей) — 65 мм, правая — 120 мм. */
  readonly stampLeftWidth: number;
  /** Нижняя граница контента: всё, что ниже, занято штампом или выходом за рамку. */
  readonly contentBottom: number;

  constructor(
    private readonly document: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
    format: JournalFormat,
    private readonly scale: number,
  ) {
    const size = PAGE_SIZES[format];
    this.width = size.width;
    this.height = size.height;
    this.content = this.width - this.margin * 2;
    const bottom = this.frame;
    const left = this.width - this.frame - STAMP_WIDTH;
    this.stamp = { width: STAMP_WIDTH, height: STAMP_HEIGHT, left, bottom, top: bottom + STAMP_HEIGHT };
    this.stampLeftWidth = this.stamp.width * (65 / 185);
    // Небольшой зазор между последней строкой контента и верхней линией штампа.
    this.contentBottom = this.stamp.top + 8;
    this.addPage();
  }

  /** Высота контентной области на листе без штампа. */
  get contentHeight(): number {
    return this.height - this.margin - this.contentBottom;
  }

  addPage(): PDFPage {
    this.page = this.document.addPage([this.width, this.height]);
    this.pages.push(this.page);
    this.y = this.height - this.margin;
    return this.page;
  }

  ensure(height: number): void {
    if (this.y - height < this.contentBottom) this.addPage();
  }

  /** Титульный лист (страница 1): рамку и колонтитул дорисует finish(). */
  titlePage(project: Project): void {
    const document = project.document ?? {};
    const page = this.page;
    const center = (content: string, y: number, size: number, font: PDFFont, color = BRAND): void => {
      const width = font.widthOfTextAtSize(content, size);
      page.drawText(content, { x: Math.max(this.margin, (this.width - width) / 2), y, size, font, color });
    };
    const documentTitle = (document.title ?? '').trim() || 'Кабельный журнал и смета';
    const organization = (document.organization ?? '').trim();
    const object = (document.object ?? '').trim();
    const code = (document.documentCode ?? '').trim();
    const city = (document.city ?? '').trim();
    const date = (document.date ?? '').trim();
    const compiledBy = (document.compiledBy ?? '').trim();
    const checkedBy = (document.checkedBy ?? '').trim();

    if (organization) center(organization, this.height - 92, 13, this.bold);
    center(`Проект: ${project.name || 'Без названия'}`, this.height - 118, 9.5, this.regular, MUTED);

    const titleLines = wrapText(documentTitle, this.bold, 24, this.content);
    titleLines.forEach((line, index) => center(line, this.height - 250 - index * 30, 24, this.bold));
    let y = this.height - 250 - titleLines.length * 30 - 10;
    if (object) {
      for (const line of wrapText(`Объект: ${object}`, this.regular, 11.5, this.content)) {
        center(line, y, 11.5, this.regular);
        y -= 16;
      }
    }
    if (code) center(`Шифр: ${code}`, Math.min(y - 6, this.height - 330), 11, this.bold);
    y = Math.min(y - 28, this.height - 360);

    const signature = (label: string, value: string, lineY: number): void => {
      page.drawText(`${label}:`, { x: this.margin + 110, y: lineY, size: 10.5, font: this.bold, color: BRAND });
      const lineStart = this.margin + 190;
      const lineEnd = this.width - this.margin - 150;
      page.drawLine({ start: { x: lineStart, y: lineY - 2 }, end: { x: lineEnd, y: lineY - 2 }, thickness: 0.6, color: MUTED });
      if (value) page.drawText(value, { x: lineStart + 6, y: lineY, size: 10, font: this.regular, color: BRAND });
      page.drawText('подпись', { x: lineEnd + 8, y: lineY - 1, size: 7.5, font: this.regular, color: MUTED });
    };
    signature('Составил', compiledBy, y);
    signature('Проверил', checkedBy, y - 28);
    if (date) center(`Дата: ${formatDateRu(date)}`, y - 68, 10, this.regular);
    const year = /^\d{4}/.test(date) ? date.slice(0, 4) : String(new Date().getFullYear());
    center(city ? `${city} · ${year}` : year, this.height - 500, 11, this.regular);
  }

  /** Заголовок раздела; возвращает фактический номер страницы, где он начинается. */
  heading(title: string, note?: string): number {
    this.ensure(56);
    const page = this.pages.length;
    this.page.drawText(title, { x: this.margin, y: this.y - 16, size: 13.5, font: this.bold, color: BRAND });
    this.y -= 22;
    if (note) {
      const size = 8.2;
      const lineHeight = 10.5;
      // Длинное примечание переносится построчно: страница не должна переполняться.
      for (const line of wrapText(note, this.regular, size, this.content)) {
        if (this.y - lineHeight < this.contentBottom) this.addPage();
        this.page.drawText(line, { x: this.margin, y: this.y - 8, size, font: this.regular, color: MUTED });
        this.y -= lineHeight;
      }
      this.y -= 4;
    }
    this.y -= 4;
    return page;
  }

  /** Абзац с построчным переносом: длинный текст не съезжает за нижнюю границу. */
  paragraph(text: string, color = BRAND): void {
    const size = 8.6;
    const lineHeight = size + 3;
    for (const line of wrapText(text, this.regular, size, this.content)) {
      if (this.y - lineHeight < this.contentBottom) this.addPage();
      this.page.drawText(line, { x: this.margin, y: this.y - size, size, font: this.regular, color });
      this.y -= lineHeight;
    }
    this.y -= 6;
  }

  list(items: string[]): void {
    for (const item of items) this.paragraph(`• ${item}`, DANGER);
  }

  /**
   * Таблица с переносом строк между листами.
   *
   * Строка, не влезающая на текущую страницу, но влезающая на пустую, переносится
   * целиком. Строка выше страницы делится по строкам текста: каждая часть повторяет
   * шапку, продолжение помечается «(продолж.)», над шапкой печатается название
   * раздела. Ни один фрагмент текста не теряется.
   */
  table(columns: Column[], rows: TableRow[], sectionTitle?: string): void {
    const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
    const widthScale = this.content / (totalWidth || 1);
    const widths = columns.map(column => column.width * widthScale);
    const size = 7.6 * this.scale;
    const headerSize = 7.4 * this.scale;
    const lineHeight = size + 2.6 * this.scale;
    const padding = 4 * this.scale;
    const rowPadding = padding * 1.4;
    // Шапка переносится по словам, а не обрезается многоточием: «Запас кабеля»
    // в 2.10.0 печаталось как «Запас каб…» и читалось как потерянный столбец.
    const headerLines = columns.map((column, index) =>
      wrapText(column.title, this.bold, headerSize, Math.max(1, widths[index] - padding * 2)));
    const headerLineCount = Math.max(1, ...headerLines.map(lines => lines.length));
    const headerHeight = Math.max(18 * this.scale, headerLineCount * (headerSize + 1.8) + padding * 1.6);

    const drawHeader = (): void => {
      this.page.drawRectangle({ x: this.margin, y: this.y - headerHeight, width: this.content, height: headerHeight, color: BRAND });
      let x = this.margin;
      headerLines.forEach((lines, index) => {
        lines.forEach((line, lineIndex) => {
          this.page.drawText(line, {
            x: x + padding,
            y: this.y - padding * 0.8 - headerSize - lineIndex * (headerSize + 1.8),
            size: headerSize,
            font: this.bold,
            color: WHITE,
          });
        });
        x += widths[index];
      });
      this.y -= headerHeight;
    };

    /** Шапка новой страницы с подписью продолжения раздела. */
    const beginPage = (continuation: boolean): void => {
      if (continuation && sectionTitle) {
        const captionSize = 7.4;
        this.page.drawText(`Продолжение: ${sectionTitle}`, {
          x: this.margin, y: this.y - captionSize, size: captionSize, font: this.regular, color: MUTED,
        });
        this.y -= captionSize + 5;
      }
      drawHeader();
    };

    const fitLines = (): number => Math.max(0, Math.floor((this.y - this.contentBottom - rowPadding) / lineHeight));

    const drawRow = (parts: string[][], height: number, bold: boolean, zebra: boolean, danger: boolean): void => {
      if (zebra) this.page.drawRectangle({ x: this.margin, y: this.y - height, width: this.content, height, color: ZEBRA });
      let x = this.margin;
      parts.forEach((lines, index) => {
        const column = columns[index] ?? { title: '', width: 0 };
        const font = bold && index === 0 ? this.bold : this.regular;
        const color = danger ? DANGER : BRAND;
        lines.forEach((line, lineIndex) => {
          const textWidth = font.widthOfTextAtSize(line, size);
          const drawX = column.align === 'right' ? x + widths[index] - padding - textWidth : x + padding;
          this.page.drawText(line, { x: drawX, y: this.y - padding - size - lineIndex * lineHeight + 2, size, font, color });
        });
        x += widths[index];
      });
      this.page.drawLine({ start: { x: this.margin, y: this.y - height }, end: { x: this.margin + this.content, y: this.y - height }, thickness: 0.5, color: BORDER });
      this.y -= height;
    };

    this.ensure(headerHeight + lineHeight * 2 + 8);
    beginPage(false);

    rows.forEach((row, rowIndex) => {
      const cells = rowCells(row);
      const bold = rowBold(row);
      const zebra = rowZebra(row) || rowIndex % 2 === 1;
      const danger = cells.some(value => String(value).toLowerCase().includes('неполный'));
      const wrapped = cells.map((value, index) => wrapText(value, this.regular, size, Math.max(1, widths[index] - padding * 2)));
      const lineCount = Math.max(1, ...wrapped.map(lines => lines.length));
      const height = lineCount * lineHeight + rowPadding;

      if (height <= this.y - this.contentBottom) {
        drawRow(wrapped, height, bold, zebra, danger);
        return;
      }
      // Строка целиком влезает на пустой лист — переносим её, как раньше.
      // Свежий лист тратит место на шапку (и подпись продолжения), поэтому сравниваем
      // не с полной высотой контента, а с остатком после них: иначе строка уходит ниже штампа.
      const freshCapacity = this.contentHeight - headerHeight - (sectionTitle ? 12.4 : 0) - 2;
      if (height <= freshCapacity) {
        this.addPage();
        beginPage(true);
        drawRow(wrapped, height, bold, zebra, danger);
        return;
      }
      // Строка выше листа: делим по строкам текста между страницами.
      let offset = 0;
      let continuation = false;
      while (offset < lineCount) {
        let available = fitLines();
        if (continuation && available < 2) {
          this.addPage();
          beginPage(true);
          available = fitLines();
        } else if (available < 1) {
          this.addPage();
          beginPage(true);
          available = fitLines();
        }
        if (available < 1) {
          // Защита от вырожденного листа: один шаг обязан продвинуть разбиение.
          this.addPage();
          beginPage(true);
          available = Math.max(1, fitLines());
        }
        const parts: string[][] = [];
        let chunkLines = 0;
        let consumed = 0;
        wrapped.forEach((lines, index) => {
          // В первой ячейке части-продолжения маркер занимает отдельную строку.
          const limit = continuation && index === 0 ? Math.max(0, available - 1) : available;
          const slice = lines.slice(offset, offset + limit);
          const part = continuation && index === 0 ? ['(продолж.)', ...slice] : slice;
          parts.push(part);
          chunkLines = Math.max(chunkLines, part.length);
          consumed = Math.max(consumed, slice.length);
        });
        if (chunkLines === 0 || consumed === 0) break;
        drawRow(parts, chunkLines * lineHeight + rowPadding, bold, zebra, danger);
        offset += consumed;
        continuation = true;
      }
    });
    this.y -= 14;
  }

  /** Текст итоговой плашки журнала (метраж и стоимость) для листа итогов и подписей. */
  private journalSummary(project: Project): string {
    let meters = 0;
    let metersComplete = true;
    let cost = 0;
    let costComplete = true;
    // Та же стоимость, что в смете: строка округляется правилом проекта, а не
    // сырая цена × метраж — иначе в одном PDF два разных итога кабелей.
    const rounding = normalizeRounding(project.estimate?.rounding) ?? 0.01;
    for (const cable of project.cables) {
      const result = calculateCable(project, cable);
      if (result.total === null) metersComplete = false;
      else meters += result.total * cable.quantity;
      if (result.cost === null) costComplete = false;
      else cost += roundMoney(result.cost, rounding);
    }
    const parts = [
      metersComplete ? `Итого кабеля по журналу: ${formatNumber(meters)} м` : 'Итого кабеля по журналу: рассчитано не полностью',
      costComplete && project.cables.length ? `стоимость: ${formatMoney(cost)} ₽` : 'стоимость: цены заданы не для всех кабелей',
    ];
    return parts.join(' · ');
  }

  totals(project: Project): void {
    const summary = this.journalSummary(project);
    this.ensure(40);
    this.page.drawRectangle({ x: this.margin, y: this.y - 22, width: this.content, height: 22, color: ZEBRA });
    this.page.drawText(summary, { x: this.margin + 8, y: this.y - 15, size: 8.6, font: this.bold, color: BRAND });
    this.y -= 30;
  }

  /**
   * Блок подписей. Без `ownSheet` — внизу последнего листа (новый лист только при
   * нехватке места). С `ownSheet` — всегда отдельный лист «Подписи»; возвращает
   * номер этого листа для оглавления (иначе null).
   */
  signatures(project: Project, ownSheet = false): number | null {
    const compiledBy = (project.document?.compiledBy || '').trim();
    const checkedBy = (project.document?.checkedBy || '').trim();
    const date = (project.document?.date || '').trim() || new Date().toLocaleDateString('ru-RU');
    // Одинокий блок подписей внизу листа лучше, чем почти пустой лист с тремя строками.
    const needed = 98;
    let page: number | null = null;
    if (ownSheet || this.y - needed < this.contentBottom) {
      this.addPage();
      page = ownSheet ? this.pages.length : null;
      this.y -= 2;
      this.page.drawText('Подписи', { x: this.margin, y: this.y - 13, size: 12, font: this.bold, color: BRAND });
      this.y -= 24;
      // Лист подписей не должен быть почти пустым: на нём итог журнала.
      const summary = this.journalSummary(project);
      this.page.drawRectangle({ x: this.margin, y: this.y - 22, width: this.content, height: 22, color: ZEBRA });
      this.page.drawText(summary, { x: this.margin + 8, y: this.y - 15, size: 8.6, font: this.bold, color: BRAND });
      this.y -= 30;
    }
    this.y -= 6;
    this.page.drawLine({ start: { x: this.margin, y: this.y }, end: { x: this.margin + this.content, y: this.y }, thickness: 0.8, color: BORDER });
    this.y -= 22;
    const rows: { label: string; value: string }[] = [
      { label: 'Составил', value: compiledBy },
      { label: 'Проверил', value: checkedBy },
    ];
    for (const row of rows) {
      this.page.drawText(`${row.label}:`, { x: this.margin, y: this.y, size: 9, font: this.bold, color: BRAND });
      const lineStart = this.margin + 70;
      const lineEnd = this.margin + this.content - 160;
      this.page.drawLine({ start: { x: lineStart, y: this.y - 2 }, end: { x: lineEnd, y: this.y - 2 }, thickness: 0.6, color: MUTED });
      if (row.value) this.page.drawText(row.value, { x: lineStart + 6, y: this.y, size: 9, font: this.regular, color: BRAND });
      this.page.drawText('подпись', { x: lineEnd + 6, y: this.y, size: 7.5, font: this.regular, color: MUTED });
      this.y -= 26;
    }
    this.page.drawText(`Дата: ${formatDateRu(date)}`, { x: this.margin, y: this.y, size: 9, font: this.regular, color: BRAND });
    this.page.drawText('Документ сформирован в AnOOPlan', { x: this.margin + this.content - 170, y: this.y, size: 7.5, font: this.regular, color: MUTED });
    this.y -= 18;
    return page;
  }

  /** Фотографии; возвращает номер страницы заголовка или null, если снимков нет. */
  async photos(items: JournalPhoto[], title = 'Фотографии оборудования'): Promise<number | null> {
    if (!items.length) return null;
    const gap = 16;
    const cellWidth = (this.content - gap) / 2;
    const imageHeight = 200;
    const captionHeight = 22;
    // Заголовок и первый ряд снимков — на одном листе: иначе заголовок остаётся сиротой.
    this.ensure(56 + imageHeight + captionHeight + 12);
    const page = this.heading(title, `Снимков в проекте: ${items.length}. Форматы: JPEG и PNG.`);
    for (let index = 0; index < items.length; index += 2) {
      const row = items.slice(index, index + 2);
      this.ensure(imageHeight + captionHeight + 12);
      for (let column = 0; column < row.length; column += 1) {
        const item = row[column];
        const x = this.margin + column * (cellWidth + gap);
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

  /** Планы этажей; возвращает записи оглавления (по одной на план). `reserveBottom` —
   * место под последующий блок подписей на последнем листе (чтобы документ не заканчивался
   * почти пустой страницей с одними подписями). */
  async plans(items: JournalPlan[], reserveBottom = 0): Promise<TocEntry[]> {
    const entries: TocEntry[] = [];
    // Один масштаб на все листы планов: иначе последний лист (с резервом под подписи)
    // печатался мельче остальных, и этажи выглядели в разных масштабах.
    const noteLinesOf = (item: JournalPlan) => (item.note ? wrapText(item.note, this.regular, 8.6, this.content).length : 0);
    // Резерв под подписи в масштаб НЕ входит: иначе все листы планов уменьшались,
    // а план — главное на листе. Блок подписей при нехватке места уйдёт на свой лист.
    const sharedMaxHeight = Math.max(160, Math.min(380,
      this.contentHeight - 110 - Math.max(0, ...items.map(noteLinesOf)) * 13));
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const reserve = index === items.length - 1 ? reserveBottom : 0;
      // Заголовок и изображение должны попасть на один лист: резервируем место сразу
      // под заголовок, примечание и фактическую высоту картинки. Иначе заголовок
      // остаётся сиротой внизу листа, а план уезжает на следующий (регрессия 2.3.0).
      const noteLines = noteLinesOf(item);
      let rendered: { image: PDFImage; width: number; height: number } | null;
      try {
        const image = await this.document.embedPng(item.png);
        const scale = Math.min(this.content / image.width, sharedMaxHeight / image.height);
        rendered = { image, width: image.width * scale, height: image.height * scale };
      } catch {
        rendered = null;
      }
      this.ensure(56 + noteLines * 13 + 10 + (rendered ? rendered.height + 16 : 20) + reserve);
      const title = `План: ${item.title}`;
      const page = this.heading(title, 'Подложка этажа и нанесённые трассы с оборудованием — лист для подписи.');
      entries.push({ title, page });
      if (item.note) this.paragraph(item.note, DANGER);
      if (rendered) {
        const { image, width, height } = rendered;
        this.page.drawImage(image, { x: this.margin + (this.content - width) / 2, y: this.y - height, width, height });
        this.page.drawRectangle({ x: this.margin, y: this.y - height, width: this.content, height, borderColor: BORDER, borderWidth: 0.6 });
        this.y -= height + 18;
      } else {
        this.paragraph('План не встроен: не удалось подготовить изображение.', DANGER);
      }
    }
    return entries;
  }

  /** Оглавление: рисуется в конце, когда известны фактические страницы разделов. */
  drawContents(pages: PDFPage[], entries: TocEntry[]): void {
    const size = 10.5;
    const step = 23;
    let pageIndex = 0;
    let page = pages[0];
    const header = (target: PDFPage, continued: boolean): number => {
      target.drawText(continued ? 'Оглавление (продолжение)' : 'Оглавление', { x: this.margin, y: this.height - this.margin - 22, size: 16, font: this.bold, color: BRAND });
      target.drawLine({ start: { x: this.margin, y: this.height - this.margin - 34 }, end: { x: this.width - this.margin, y: this.height - this.margin - 34 }, thickness: 0.8, color: BORDER });
      return this.height - this.margin - 64;
    };
    let y = header(page, false);
    for (const entry of entries) {
      if (y < this.contentBottom + 20) {
        pageIndex += 1;
        if (pageIndex >= pages.length) break;
        page = pages[pageIndex];
        y = header(page, true);
      }
      page.drawText(entry.title, { x: this.margin, y, size, font: this.regular, color: BRAND });
      const numberText = String(entry.page);
      const numberWidth = this.regular.widthOfTextAtSize(numberText, size);
      page.drawText(numberText, { x: this.width - this.margin - numberWidth, y, size, font: this.regular, color: BRAND });
      const titleWidth = this.regular.widthOfTextAtSize(entry.title, size);
      page.drawLine({ start: { x: this.margin + titleWidth + 8, y: y + 3 }, end: { x: this.width - this.margin - numberWidth - 8, y: y + 3 }, thickness: 0.4, color: BORDER });
      y -= step;
    }
    if (!entries.length) page.drawText('Разделы не выбраны.', { x: this.margin, y, size, font: this.regular, color: MUTED });
  }

  /**
   * Полная основная надпись по ГОСТ 2.104 (форма 2 для текстовых документов):
   * левая часть 65 мм — 5 строк подписей (фамилия/подпись/дата), правая 120 мм —
   * изменение/лист/документ/подпись/дата, обозначение, заголовок, организация и
   * «Лит. | Лист | Листов». Рисуется на всех листах, кроме титульного.
   */
  private drawStamp(page: PDFPage, project: Project, sheet: number, sheets: number): void {
    const document = project.document ?? {};
    const x0 = this.stamp.left;
    const x1 = x0 + this.stamp.width;
    const y0 = this.stamp.bottom;
    const y1 = this.stamp.top;
    const middleX = x0 + this.stampLeftWidth;
    const rightWidth = x1 - middleX;
    const line = (start: { x: number; y: number }, end: { x: number; y: number }, thickness = 0.4): void =>
      page.drawLine({ start, end, thickness, color: BRAND });
    page.drawRectangle({ x: x0, y: y0, width: this.stamp.width, height: this.stamp.height, borderColor: BRAND, borderWidth: 0.8 });
    line({ x: middleX, y: y0 }, { x: middleX, y: y1 });

    // Левая часть: 5 подписных строк, колонки «фамилия / подпись / дата».
    const signatureRows: [string, string][] = [
      ['Разраб.', (document.compiledBy ?? '').trim() || '—'],
      ['Пров.', (document.checkedBy ?? '').trim() || '—'],
      ['Т.контр.', '—'],
      ['Н.контр.', '—'],
      ['Утв.', '—'],
    ];
    const rowHeight = this.stamp.height / signatureRows.length;
    const labelWidth = 40;
    const nameWidth = 76;
    const signWidth = 44;
    [x0 + labelWidth, x0 + labelWidth + nameWidth, x0 + labelWidth + nameWidth + signWidth]
      .forEach(x => line({ x, y: y0 }, { x, y: y1 }));
    signatureRows.forEach(([label, value], index) => {
      const top = y1 - index * rowHeight;
      if (index > 0) line({ x: x0, y: top }, { x: middleX, y: top });
      const baseline = top - rowHeight + 7;
      page.drawText(label, { x: x0 + 3, y: baseline, size: 6.2, font: this.bold, color: BRAND });
      page.drawText(fitText(value, this.regular, 6.2, nameWidth - 6), { x: x0 + labelWidth + 3, y: baseline, size: 6.2, font: this.regular, color: BRAND });
    });

    // Правая часть, верхняя строка «Изм. | Лист | № докум. | Подп. | Дата».
    const topHeight = 16;
    const bottomHeight = 16;
    const topBottom = y1 - topHeight;
    line({ x: middleX, y: topBottom }, { x: x1, y: topBottom });
    const lastChange = (document.changeLog ?? []).slice(-1)[0];
    const headerCells: [string, string][] = [
      ['Изм.', (lastChange?.version ?? '').trim() || '—'],
      ['Лист', String(sheet)],
      ['№ докум.', (document.documentCode ?? '').trim() || '—'],
      ['Подп.', '—'],
      ['Дата', formatDateRu(lastChange?.date)],
    ];
    const headerFractions = [0.08, 0.1, 0.34, 0.24, 0.24];
    let cursor = middleX;
    headerCells.forEach(([label, value], index) => {
      if (index > 0) line({ x: cursor, y: topBottom }, { x: cursor, y: y1 });
      const cellWidth = rightWidth * headerFractions[index];
      page.drawText(label, { x: cursor + 2, y: y1 - 7, size: 5.2, font: this.regular, color: MUTED });
      page.drawText(fitText(value, this.bold, 6, Math.max(1, cellWidth - 4)), { x: cursor + 2, y: topBottom + 4, size: 6, font: this.bold, color: BRAND });
      cursor += cellWidth;
    });

    // Три строки правой части: обозначение документа, заголовок, организация.
    const bodyTop = topBottom;
    const bodyBottom = y0 + bottomHeight;
    const bodyHeight = (bodyTop - bodyBottom) / 3;
    const bodyRows: { text: string; size: number; bold: boolean }[] = [
      { text: (document.documentCode ?? '').trim() || '—', size: 6.6, bold: false },
      { text: (document.title ?? '').trim() || 'Кабельный журнал и смета', size: 7.6, bold: true },
      { text: (document.organization ?? '').trim() || '—', size: 6.6, bold: false },
    ];
    bodyRows.forEach((row, index) => {
      const top = bodyTop - index * bodyHeight;
      if (index > 0) line({ x: middleX, y: top }, { x: x1, y: top });
      page.drawText(fitText(row.text, row.bold ? this.bold : this.regular, row.size, rightWidth - 8), {
        x: middleX + 4, y: top - bodyHeight + 6, size: row.size, font: row.bold ? this.bold : this.regular, color: BRAND,
      });
    });

    // Нижняя строка «Лит. | Лист | Листов»: лист N и листов M — словами рядом с числом.
    line({ x: middleX, y: bodyBottom }, { x: x1, y: bodyBottom });
    const bottomCells: [string, string][] = [['Лит.', '—'], ['Лист', String(sheet)], ['Листов', String(sheets)]];
    const bottomFractions = [0.16, 0.42, 0.42];
    let bottomX = middleX;
    bottomCells.forEach(([label, value], index) => {
      if (index > 0) line({ x: bottomX, y: y0 }, { x: x1, y: bodyBottom });
      const cellWidth = rightWidth * bottomFractions[index];
      page.drawText(fitText(`${label} ${value}`, index === 0 ? this.regular : this.bold, 6.4, Math.max(1, cellWidth - 6)), {
        x: bottomX + 3, y: y0 + 5, size: 6.4, font: index === 0 ? this.regular : this.bold, color: BRAND,
      });
      bottomX += cellWidth;
    });
  }

  finish(project?: Project): void {
    const total = this.pages.length;
    // Колонтитул подписывает документ, а не момент экспорта: дата генерации в нём
    // расходилась с датой документа на титуле и в штампе.
    const today = formatDateRu((project?.document?.date ?? '').trim()) || new Date().toLocaleDateString('ru-RU');
    this.pages.forEach((page, index) => {
      const titlePage = index === 0;
      // Рамка листа и колонтитул с названием проекта — документ можно подписывать постранично.
      page.drawRectangle({ x: this.frame, y: this.frame, width: this.width - this.frame * 2, height: this.height - this.frame * 2, borderColor: BRAND, borderWidth: 0.8 });
      const footerEnd = titlePage ? this.width - this.margin : this.stamp.left - 8;
      page.drawLine({ start: { x: this.margin, y: this.margin + 18 }, end: { x: footerEnd, y: this.margin + 18 }, thickness: 0.5, color: BORDER });
      const title = fitText(project ? `AnOOPlan · ${project.name}` : 'AnOOPlan · кабельный план', this.regular, 7.5, Math.max(80, Math.min(260, footerEnd - this.margin)));
      page.drawText(title, { x: this.margin, y: this.margin + 6, size: 7.5, font: this.regular, color: MUTED });
      if (titlePage) {
        const middle = `Кабельный журнал · ${today}`;
        const middleWidth = this.regular.widthOfTextAtSize(middle, 7.5);
        page.drawText(middle, { x: (this.width - middleWidth) / 2, y: this.margin + 6, size: 7.5, font: this.regular, color: MUTED });
        const label = `Лист ${index + 1} из ${total}`;
        const width = this.regular.widthOfTextAtSize(label, 7.5);
        page.drawText(label, { x: this.width - this.margin - width, y: this.margin + 6, size: 7.5, font: this.regular, color: MUTED });
      } else if (project) {
        this.drawStamp(page, project, index + 1, total);
      }
    });
  }
}
