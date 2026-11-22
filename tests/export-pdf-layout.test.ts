import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { buildJournalPdf, formatNumber } from '../src/export-pdf';
import { createDemoProject } from '../src/demo';
import { estimate } from '../src/estimate';
import { specificationKnS } from '../src/engine';
import type { JournalFonts } from '../src/export-fonts';
import type { Pin, Project } from '../src/model';

const toArrayBuffer = (path: string): ArrayBuffer => {
  const buffer = readFileSync(new URL(path, import.meta.url));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
};

const fonts: JournalFonts = {
  regular: toArrayBuffer('../src/assets/fonts/AnOOPlanSans-Regular.ttf'),
  bold: toArrayBuffer('../src/assets/fonts/AnOOPlanSans-Bold.ttf'),
};

/** Элемент pdfjs: текст, позиция базовой линии и высота кегля. */
interface PdfItem { str?: string; transform?: number[]; height?: number }

interface PdfInfo {
  text: string;
  pages: number;
  pageTexts: string[];
  pageItems: PdfItem[][];
}

const squash = (value: string): string => value.replace(/\s+/g, ' ');

async function pdfInfo(bytes: Uint8Array): Promise<PdfInfo> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const document = await task.promise;
  const pageTexts: string[] = [];
  const pageItems: PdfItem[][] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    const items = content.items as unknown as PdfItem[];
    pageItems.push(items);
    pageTexts.push(items.map(item => item.str ?? '').join(' '));
  }
  const pages = document.numPages;
  await task.destroy();
  return { text: pageTexts.join('\n'), pages, pageTexts, pageItems };
}

async function pageSizes(bytes: Uint8Array): Promise<{ width: number; height: number }[]> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map(page => page.getSize());
}

/** Длинное примечание с уникальными фрагментами: ни один не должен потеряться. */
function longNote(): { text: string; tokens: string[] } {
  const tokens: string[] = [];
  const parts = ['Начало длинного примечания.'];
  for (let index = 1; index <= 60; index += 1) {
    const token = `ФРАГМЕНТ${String(index).padStart(2, '0')}`;
    tokens.push(token);
    parts.push(`${token} проверка переноса длинной ячейки на следующую страницу документа.`);
  }
  parts.push('Окончание длинного примечания.');
  return { text: parts.join(' '), tokens };
}

/** 30 пинов с несуществующим этажом: валидатор даёт 30 предупреждений подряд. */
function projectWithThirtyWarnings(): { project: Project; numbers: string[] } {
  const project = createDemoProject();
  const now = new Date().toISOString();
  const numbers: string[] = [];
  const extra: Pin[] = [];
  for (let index = 1; index <= 30; index += 1) {
    const number = `З-${100 + index}`;
    numbers.push(number);
    extra.push({
      id: `bad-pin-${index}`,
      number,
      floorId: 'missing-floor',
      x: 0,
      y: 0,
      comment: '',
      status: 'open',
      photos: [],
      createdAt: now,
      updatedAt: now,
    });
  }
  project.pins = [...project.pins, ...extra];
  return { project, numbers };
}

test('E-04: ячейка длиннее листа делится между страницами без потери текста', async () => {
  const { text, tokens } = longNote();
  assert.ok(text.length > 3000, `примечание должно быть длинным: ${text.length}`);

  const short = createDemoProject();
  const long = createDemoProject();
  long.pins[0].comment = text;

  const shortInfo = await pdfInfo(await buildJournalPdf(short, fonts));
  const longInfo = await pdfInfo(await buildJournalPdf(long, fonts));
  const flat = squash(longInfo.text);

  assert.ok(longInfo.pages > shortInfo.pages, `страниц должно стать больше: ${shortInfo.pages} → ${longInfo.pages}`);
  for (const token of tokens) assert.ok(flat.includes(token), `потерян фрагмент ${token}`);
  assert.ok(flat.includes('Начало длинного примечания.'), 'потеряно начало длинной ячейки');
  assert.ok(flat.includes('Окончание длинного примечания.'), 'потерян конец длинной ячейки');
  assert.ok(flat.includes('(продолж.)'), 'нет маркера продолжения ячейки');
  assert.ok(flat.includes('Продолжение: Замечания'), 'нет подписи продолжения таблицы над шапкой');
});

test('E-04: длинный список предупреждений переносится построчно, все строки на месте', async () => {
  const { project, numbers } = projectWithThirtyWarnings();
  const base = await pdfInfo(await buildJournalPdf(createDemoProject(), fonts));
  const info = await pdfInfo(await buildJournalPdf(project, fonts));
  const flat = squash(info.text);

  assert.ok(info.pages > base.pages, `предупреждения должны добавить страницы: ${base.pages} → ${info.pages}`);
  for (const number of numbers) {
    assert.ok(flat.includes(`Замечание ${number}: этаж не найден`), `потеряно предупреждение ${number}`);
  }
  // Страницы идут подряд: в тексте каждой есть свой номер и общее число листов.
  for (let index = 1; index < info.pages; index += 1) {
    assert.ok(info.pageTexts[index].includes(`Лист ${index + 1}`), `нет номера листа на странице ${index + 1}`);
    assert.ok(info.pageTexts[index].includes(`Листов ${info.pages}`), `нет числа листов на странице ${index + 1}`);
  }
});

test('штамп: «Лист»/«Листов» с фактическими номерами на каждой содержательной странице', async () => {
  const project = createDemoProject();
  const { pageTexts, pages } = await pdfInfo(await buildJournalPdf(project, fonts));
  for (let index = 1; index < pages; index += 1) {
    assert.ok(pageTexts[index].includes(`Лист ${index + 1}`), `неверный номер листа на странице ${index + 1}`);
    assert.ok(pageTexts[index].includes(`Листов ${pages}`), `неверное число листов на странице ${index + 1}`);
    for (const label of ['Изм.', '№ докум.', 'Подп.', 'Дата', 'Разраб.', 'Пров.', 'Т.контр.', 'Н.контр.', 'Утв.', 'Лит.']) {
      assert.ok(pageTexts[index].includes(label), `на странице ${index + 1} нет поля «${label}»`);
    }
  }
  assert.ok(!pageTexts[0].includes('Разраб.'), 'на титульном листе не должно быть штампа');
});

test('штамп: последняя строка таблицы заканчивается выше верхней линии штампа', async () => {
  const project = createDemoProject();
  const { pageItems } = await pdfInfo(await buildJournalPdf(project, fonts));
  // Основная надпись 40 мм прижата к рамке: 18 + 40×2,83465 = 131,386 pt.
  const stampTop = 18 + 40 * 2.83465;
  let checked = 0;
  pageItems.forEach((items, pageIndex) => {
    if (pageIndex === 0) return;
    for (const item of items) {
      if ((item.str === 'полный' || item.str === 'неполный') && item.transform) {
        const y = item.transform[5];
        assert.ok(y > stampTop, `строка таблицы на странице ${pageIndex + 1} наезжает на штамп: y=${y.toFixed(1)}`);
        checked += 1;
      }
    }
  });
  assert.ok(checked >= project.cables.length, `проверено строк таблицы: ${checked}`);
});

test('формат: A4 горизонт по умолчанию и A3 горизонт целиком', async () => {
  const project = createDemoProject();
  const a4 = await pageSizes(await buildJournalPdf(project, fonts));
  assert.ok(a4.length > 1);
  for (const size of a4) assert.deepEqual(size, { width: 842, height: 595 });

  const a3Bytes = await buildJournalPdf(project, fonts, { format: 'a3l' });
  const a3 = await pageSizes(a3Bytes);
  assert.ok(a3.length > 1);
  for (const size of a3) assert.deepEqual(size, { width: 1191, height: 842 });

  const { text } = await pdfInfo(a3Bytes);
  assert.ok(text.includes('Кабельный журнал'), 'A3: потерян журнал');
  assert.ok(text.includes('Листов'), 'A3: потерян штамп');
  assert.ok(text.includes('Оглавление'), 'A3: потеряно оглавление');
  assert.ok(text.includes('Итого по смете'), 'A3: потеряна смета');
});

test('масштаб: 90 % и 110 % меняют кегль таблиц, вне диапазона — 100 %', async () => {
  const project = createDemoProject();
  const headerHeight = async (bytes: Uint8Array): Promise<number> => {
    const info = await pdfInfo(bytes);
    const heights = info.pageItems
      .flat()
      .filter(item => item.str === 'Ø, мм' && typeof item.height === 'number')
      .map(item => item.height as number);
    assert.ok(heights.length > 0, 'не найден заголовок колонки «Ø, мм»');
    return Math.max(...heights);
  };
  const small = await headerHeight(await buildJournalPdf(project, fonts, { scale: 0.9 }));
  const normal = await headerHeight(await buildJournalPdf(project, fonts));
  const large = await headerHeight(await buildJournalPdf(project, fonts, { scale: 1.1 }));
  const clamped = await headerHeight(await buildJournalPdf(project, fonts, { scale: 5 }));
  assert.ok(small < normal, `0,9 должен уменьшать кегль: ${small} vs ${normal}`);
  assert.ok(large > normal, `1,1 должен увеличивать кегль: ${large} vs ${normal}`);
  assert.ok(Math.abs(clamped - normal) < 0.01, `вне диапазона масштаб должен быть 1: ${clamped} vs ${normal}`);
});

test('смета: работы по видам, НДС, округление и итог с НДС попадают в PDF', async () => {
  const project = createDemoProject();
  project.estimate = {
    works: [
      { id: 'w1', name: 'Монтаж камеры', unit: 'шт', quantity: 2, price: 1500 },
      { id: 'w2', name: 'Пусконаладка', unit: 'шт', quantity: 1, price: 4000 },
    ],
    note: 'Цены действительны 30 дней',
    laborPercent: 25,
    vatRate: 20,
    vatIncluded: false,
    rounding: 1,
  };
  const result = estimate(project);
  assert.equal(result.worksMode, 'items');
  assert.notEqual(result.gross, null);
  assert.notEqual(result.vat, null);

  const flat = squash((await pdfInfo(await buildJournalPdf(project, fonts))).text);
  for (const expected of ['Монтаж камеры', 'Пусконаладка', 'Итого материалы', 'Работы (по видам работ)', 'Итого до НДС', 'НДС 20 %', 'Итого с НДС', 'Округление: до 1 ₽', 'Цены без НДС']) {
    assert.ok(flat.includes(expected), `в PDF нет «${expected}»`);
  }
  assert.ok(flat.includes(squash(formatNumber(result.gross))), 'в PDF нет итога с НДС');
  assert.ok(flat.includes(squash(formatNumber(result.vat))), 'в PDF нет суммы НДС');
  assert.ok(!/NaN/.test(flat), 'в PDF попал NaN');
});

test('КНС: подытоги по подсистемам и «Всего КНС» с метражом и стоимостью', async () => {
  const project = createDemoProject();
  project.routes[0].subsystem = 'trunk';
  project.routes[1].subsystem = 'horizontal';
  project.routes[2].subsystem = 'horizontal';
  const spec = specificationKnS(project);
  assert.ok(spec.subsystems.length >= 2, 'в демо должно быть две подсистемы');

  const flat = squash((await pdfInfo(await buildJournalPdf(project, fonts))).text);
  for (const group of spec.subsystems) {
    assert.ok(flat.includes(`Итого по подсистеме: ${group.subsystem}`), `нет подытога «${group.subsystem}»`);
  }
  assert.ok(flat.includes('Итого по типам'), 'нет итогов по типам');
  assert.ok(flat.includes('Всего КНС:'), 'нет строки «Всего КНС»');
  assert.ok(flat.includes(squash(`${formatNumber(spec.totalLength)} м`)), 'нет общего метража КНС');
  assert.ok(flat.includes(squash(`${formatNumber(spec.totalCost)} ₽`)), 'нет общей стоимости КНС');
});
