import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { buildJournalPdf, formatDateRu, formatMoney, formatNumber } from '../src/export-pdf';
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
  for (const expected of ['Монтаж камеры', 'Пусконаладка', 'Итого материалы', 'Работы (по видам)', 'Итого до НДС', 'НДС 20 %', 'Итого с НДС', 'Округление: до 1 ₽', 'Цены без НДС']) {
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

/** Серый PNG заданного размера: нужны настоящие пропорции листа, а не 1×1. */
function grayPng(width: number, height: number): Uint8Array {
  const raw = Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(width, 200)])));
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 0; header[10] = 0; header[11] = 0; header[12] = 0;
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]));
}

/** Сколько растровых изображений на листе (pdfjs operator list). */
async function pageImageCount(bytes: Uint8Array, pageNumber: number): Promise<number> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const document = await task.promise;
  const page = await document.getPage(pageNumber);
  const ops = await page.getOperatorList();
  const count = ops.fnArray.filter((fn: number) => fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject).length;
  await task.destroy();
  return count;
}

test('планы: заголовок и изображение всегда на одном листе (регрессия E-03)', async () => {
  const png = grayPng(1600, 1131);
  const plans = [1, 2, 3, 4].map(number => ({ title: `Помещение ${number}`, png }));
  // Полный комплект разделов: перед планами лист заполнен, поэтому проверяется резерв места.
  const info = await pdfInfo(await buildJournalPdf(createDemoProject(), fonts, { plans }));
  const headingPages = info.pageTexts
    .map((text, index) => ({ text, page: index + 1 }))
    .filter(item => (item.text.match(/План:/g) ?? []).length === 1 && !item.text.includes('Оглавление'));
  assert.equal(headingPages.length, plans.length, `заголовков планов: ${headingPages.length} из ${plans.length}`);
  for (const item of headingPages) {
    assert.equal(await pageImageCount(await buildJournalPdf(createDemoProject(), fonts, { plans }), item.page), 1,
      `на листе ${item.page} заголовок «План:» без изображения`);
  }
});

test('оглавление не резервирует пустой лист «(продолжение)»', async () => {
  const png = grayPng(1600, 1131);
  const plans = [1, 2, 3, 4].map(number => ({ title: `Помещение ${number}`, png }));
  const info = await pdfInfo(await buildJournalPdf(createDemoProject(), fonts, { plans }));
  const tocPages = info.pageTexts.filter(text => text.includes('Оглавление'));
  assert.equal(tocPages.length, 1, `листов оглавления: ${tocPages.length}`);
  const emptyPages = info.pageTexts.filter(text => squash(text).trim() === '');
  assert.deepEqual(emptyPages, [], 'в документе есть пустые листы');
});

test('строка таблицы не опускается под верх штампа даже при разбиении', async () => {
  const project = createDemoProject();
  // Ячейка «Замечание» на 39 строк: строка выше листа делится, и её хвост
  // раньше уходил в графы штампа (наезд на основную надпись).
  project.pins[0].comment = Array.from({ length: 40 }, (_, index) => `КОНЕЦ-${index + 1}`).join('\n');
  const info = await pdfInfo(await buildJournalPdf(project, fonts));
  const stampTop = 18 + 40 * 2.83465;
  const below = info.pageItems.flatMap((items, index) => items
    .filter(item => (item.str ?? '').includes('КОНЕЦ-') && item.transform?.[5] !== undefined && item.transform[5] < stampTop + 0.5)
    .map(item => `лист ${index + 1}: «${item.str}» y=${item.transform?.[5]?.toFixed(1)}`));
  assert.deepEqual(below, [], 'текст строки попал в область штампа');
  assert.ok(squash(info.text).includes('КОНЕЦ-40'), 'хвост длинной ячейки потерян');
});

test('2.10.1: деньги в смете печатаются до копейки, без третьего знака', async () => {
  const project = createDemoProject();
  const result = estimate(project);
  const info = await pdfInfo(await buildJournalPdf(project, fonts));
  const flat = squash(info.text);
  assert.ok(result.labor !== null, 'работы должны быть рассчитаны');
  const plain = (value: string) => value.replace(/\u00a0/g, ' ');
  const kopecks = plain(formatMoney(result.labor));
  const threeDecimals = plain(result.labor.toLocaleString('ru-RU', { maximumFractionDigits: 3 }));
  if (kopecks !== threeDecimals) {
    assert.ok(flat.includes(kopecks), `нет суммы работ до копейки «${kopecks}»`);
    assert.ok(!flat.includes(threeDecimals), `в документе осталась сумма «${threeDecimals}» с тысячными`);
  }
  // Площади кабелей печатаются с тремя знаками (28,274 мм²) — это не деньги;
  // проверяем именно денежные суммы: тысячных у рублей быть не должно.
  assert.ok(!flat.includes('28 783,675'), 'работы напечатаны с тысячными');
  assert.ok(!flat.includes('143 918,375'), 'итог напечатан с тысячными');
});

test('2.10.1: даты документа печатаются в виде ДД.ММ.ГГГГ, а не ISO', async () => {
  const project = createDemoProject();
  project.document = { ...project.document, date: '2026-10-01' };
  const info = await pdfInfo(await buildJournalPdf(project, fonts));
  const flat = squash(info.text);
  assert.ok(flat.includes('Дата: 01.10.2026'), 'дата на титуле не в русском формате');
  assert.ok(!flat.includes('2026-10-01'), 'в документе осталась ISO-дата');
});

test('2.10.1: шапка журнала печатается целиком, без многоточий', async () => {
  const info = await pdfInfo(await buildJournalPdf(createDemoProject(), fonts));
  const flat = squash(info.text);
  for (const title of ['Запас трасс', 'Запас кабеля', 'Геометрия,', 'Стоимость, ₽', 'S каб., мм²']) {
    assert.ok(flat.includes(title), `в шапке журнала потерян заголовок «${title}»`);
  }
  assert.ok(!flat.includes('Запас каб…'), 'заголовок «Запас кабеля» обрезан многоточием');
});

test('2.10.1: блок подписей не уезжает на отдельный почти пустой лист', async () => {
  const png = grayPng(1600, 1131);
  const plans = [{ title: 'Этаж 1', png }];
  const info = await pdfInfo(await buildJournalPdf(createDemoProject(), fonts, { plans }));
  const last = squash(info.pageTexts[info.pages - 1]);
  assert.ok(last.includes('Составил:'), 'на последнем листе нет блока подписей');
  assert.ok(last.includes('План:'), 'блок подписей ушёл на отдельный лист без содержимого');
});

test('2.10.1: formatMoney — до копейки, formatDateRu — ДД.ММ.ГГГГ', () => {
  const plain = (value: string) => value.replace(/\u00a0/g, ' ');
  assert.equal(plain(formatMoney(28783.675)), '28 783,68');
  assert.equal(plain(formatMoney(115134.7)), '115 134,70');
  assert.equal(formatMoney(null), '—');
  assert.equal(formatDateRu('2026-10-01'), '01.10.2026');
  assert.equal(formatDateRu(''), '—');
  assert.equal(formatDateRu('2026-10-01T00:00:00Z'), '2026-10-01T00:00:00Z');
});
