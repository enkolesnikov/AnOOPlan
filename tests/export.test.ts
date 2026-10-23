import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { exportSheets } from '../src/sheets';
import { clientCsv } from '../src/client-csv';
import { buildWorkbook } from '../src/export-xlsx';
import { buildJournalPdf, formatNumber } from '../src/export-pdf';
import type { JournalFonts } from '../src/export-fonts';
import { createDemoProject } from '../src/demo';
import { calculateCable, specifications } from '../src/engine';
import type { Project } from '../src/model';

const toArrayBuffer = (path: string): ArrayBuffer => {
  const buffer = readFileSync(new URL(path, import.meta.url));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
};

const fonts: JournalFonts = {
  regular: toArrayBuffer('../src/assets/fonts/PT_Sans-Web-Regular.ttf'),
  bold: toArrayBuffer('../src/assets/fonts/PT_Sans-Web-Bold.ttf'),
};

const SHEETS = ['Кабельный журнал', 'Оборудование', 'Кабели', 'Инфраструктура', 'Заполнение лотков', 'Замечания', 'Предупреждения'];
const JOURNAL_HEADER = ['Номер', 'Наименование', 'Марка', 'Диаметр, мм', 'Сечение, мм²', 'Назначение', 'От', 'До', 'Трасса (ID)', 'Количество', 'Геометрия, м', 'Запас трассы, м', 'Запас кабеля, м', 'Запас концов, м', 'Итог одного, м', 'Итог с количеством, м', 'Цена, ₽/м', 'Стоимость, ₽', 'Расчёт полный', 'Предупреждения', 'Примечание'];
const FILL_HEADER = ['Трасса', 'Сегмент', 'Тип трассы', 'Лоток, мм', 'Площадь лотка, мм²', 'Линий', 'Площадь кабелей, мм²', 'Заполнение, %', 'Статус'];

const emptyProject = (): Project => ({
  schemaVersion: 2, id: 'p', name: 'Пустой проект', updatedAt: '2026-01-01T00:00:00Z',
  floors: [{ id: 'f1', name: 'Этаж 1', elevation: 0, metersPerUnit: 1, page: 1, width: 1000, height: 700 }],
  equipment: [], routes: [], cables: [], pins: [],
});

/** Проект с трассой и кабелем, но без диаметра кабеля и размеров лотка: всё неизвестное — null, а не 0. */
const bareProject = (): Project => {
  const project = emptyProject();
  project.name = 'Проект без размеров';
  project.equipment = [
    { id: 'e1', number: 'Ш1', name: 'Шкаф', type: 'Шкаф', floorId: 'f1', x: 0, y: 0, height: 0, note: '', properties: {} },
    { id: 'e2', number: 'К1', name: 'Камера', type: 'Камера', floorId: 'f1', x: 10, y: 0, height: 3, note: '', properties: {} },
  ];
  project.routes = [{
    id: 'r1', number: 'Т1', type: 'Лоток', note: '',
    segments: [{ id: 's1', a: { id: 'v1', floorId: 'f1', x: 0, y: 0, height: 2.5 }, b: { id: 'v2', floorId: 'f1', x: 10, y: 0, height: 2.5 }, mode: 'orthogonal', reservePercent: 0, reserveFixed: 0 }],
  }];
  project.cables = [{
    id: 'c1', number: 'Л1', name: 'Камера', brand: 'КВК', purpose: 'Видеонаблюдение',
    fromId: 'e1', toId: 'e2', segmentIds: ['s1'], reservePercent: 10, reserveFixed: 0,
    startReserve: 0.5, endReserve: 0.5, quantity: 1, note: '',
  }];
  return project;
};

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const document = await task.promise;
  let text = '';
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    text += content.items.map(item => ('str' in item ? item.str : '')).join(' ') + '\n';
  }
  const pages = document.numPages;
  await task.destroy();
  return { text, pages };
}

test('листы выгрузки совпадают по набору с серверными', () => {
  const sheets = exportSheets(createDemoProject());
  assert.deepEqual(sheets.map(sheet => sheet.name), SHEETS);
  const [journal, equipment, , infrastructure, fill] = sheets;
  assert.deepEqual(journal.rows[0], JOURNAL_HEADER);
  assert.equal(journal.rows[0].length, 21);
  assert.equal(journal.rows.length, createDemoProject().cables.length + 1);
  assert.deepEqual(equipment.rows[0], ['Тип', 'Модель', 'Этаж', 'Количество']);
  assert.deepEqual(infrastructure.rows[0], ['Тип', 'Длина, м', 'Сегментов', 'Кабелей', 'Макс. заполнение, %', 'Сегментов с превышением']);
  assert.equal(fill.name, 'Заполнение лотков');
  assert.deepEqual(fill.rows[0], FILL_HEADER);
  const segments = createDemoProject().routes.reduce((sum, route) => sum + route.segments.length, 0);
  assert.equal(segments, 7, 'демо-проект должен содержать 7 сегментов');
  assert.equal(fill.rows.length, segments + 1);
});

test('XLSX собирается в приложении и читается обратно', () => {
  const project = createDemoProject();
  const bytes = buildWorkbook(exportSheets(project));
  assert.ok(bytes.length > 5000, `файл неожиданно маленький: ${bytes.length}`);
  const workbook = XLSX.read(bytes, { type: 'array' });
  assert.deepEqual(workbook.SheetNames, SHEETS);
  const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(workbook.Sheets['Кабельный журнал'], { defval: '' });
  assert.equal(rows.length, project.cables.length);
  assert.ok(rows.some(row => row['Номер'] === project.cables[0].number));
  assert.ok(rows.every(row => 'Итог одного, м' in row));
  assert.ok(rows.every(row => 'Диаметр, мм' in row && 'Сечение, мм²' in row));
  const first = rows.find(row => row['Номер'] === project.cables[0].number)!;
  assert.equal(first['Диаметр, мм'], 6, 'в демо-проекте у кабеля диаметр 6 мм');
  assert.ok(Math.abs(Number(first['Сечение, мм²']) - Math.PI * 9) < 0.01, 'сечение должно считаться по диаметру');
  const pins = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets['Замечания'], { defval: '' });
  assert.equal(pins.length, project.pins.length);
  assert.ok(pins.some(row => row['Номер'] === project.pins[0].number));

  const fill = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Заполнение лотков'], { header: 1, defval: '' });
  assert.deepEqual(fill[0], FILL_HEADER);
  assert.equal(fill.length, project.routes.reduce((sum, route) => sum + route.segments.length, 0) + 1);
  assert.ok(fill.slice(1).every(row => typeof row[7] === 'number'), 'заполнение в демо-проекте известно и не пустое');
  assert.ok(fill.slice(1).every(row => typeof row[4] === 'number'), 'площадь лотка в демо-проекте известна');

  const infrastructure = XLSX.utils.sheet_to_json<Record<string, string | number>>(workbook.Sheets['Инфраструктура'], { defval: '' });
  assert.ok(infrastructure.some(row => typeof row['Макс. заполнение, %'] === 'number'));
  assert.ok(infrastructure.every(row => 'Сегментов с превышением' in row));
});

test('PDF журнала собирается офлайн с кириллицей и встроенным шрифтом', async () => {
  const project = createDemoProject();
  const bytes = await buildJournalPdf(project, fonts);
  const header = new TextDecoder().decode(bytes.subarray(0, 5));
  assert.equal(header, '%PDF-');
  assert.ok(bytes.length > 20000, `PDF неожиданно маленький: ${bytes.length}`);

  const { text, pages } = await pdfText(bytes);
  assert.ok(pages >= 1);
  assert.ok(text.includes(project.name), 'название проекта не попало в PDF');
  assert.ok(text.includes('Кабельный журнал'), 'нет заголовка журнала');
  assert.ok(text.includes(project.cables[0].number), 'нет номера кабеля');
  assert.ok(text.includes('Оборудование'), 'нет ведомости оборудования');
  assert.ok(text.includes('Замечания'), 'нет ведомости замечаний');
  assert.ok(text.includes(project.pins[0].number), 'нет номера замечания');
  assert.ok(text.includes('Итого, м'), 'нет колонки итога');
  assert.ok(text.includes('полный') || text.includes('неполный'), 'нет статуса расчёта');
  // В учебном проекте цены заданы, поэтому итог PDF содержит стоимость, а не «цены заданы не для всех».
  assert.ok(text.includes('стоимость:'), 'в итоге PDF нет стоимости');
  assert.ok(!text.includes('цены заданы не для всех кабелей'), 'в демо цены заданы у всех кабелей');
  assert.ok(!text.includes('\uFFFD'), 'в тексте есть неизвестные глифы');

  // Новые колонки журнала и секция заполнения лотка.
  assert.ok(text.includes('Ø, мм'), 'нет колонки диаметра');
  assert.ok(text.includes('S, мм²'), 'нет колонки сечения');
  assert.ok(text.includes('Заполнение лотков'), 'нет секции заполнения лотков');
  assert.ok(text.includes('Заполнение, %'), 'нет колонки процента заполнения');
  assert.ok(text.includes('Внимание выше 40'), 'в примечании нет порога 40 %');
  assert.ok(text.includes('превышение выше 50'), 'в примечании нет порога 50 %');
  // В инфраструктуре PDF те же новые колонки, что и в XLSX/CSV.
  assert.ok(text.includes('Макс. заполнение, %'), 'в PDF-инфраструктуре нет колонки макс. заполнения');
  assert.ok(text.includes('Сегментов с превышением'), 'в PDF-инфраструктуре нет колонки превышений');
  assert.ok(text.includes('Площадь лотка, мм²'), 'в PDF-разделе нет площади лотка');
  const fillPercent = specifications(project).trayFill[0].fillPercent;
  assert.ok(fillPercent !== null, 'в демо-проекте заполнение должно считаться');
  assert.ok(text.includes(formatNumber(fillPercent)), `в PDF нет значения заполнения ${formatNumber(fillPercent)}`);
});

test('смета считается по цене за метр и не подменяется нулём', () => {
  const project = createDemoProject();
  const cable = project.cables[0];
  cable.pricePerMeter = 50;
  const calc = calculateCable(project, cable);
  assert.equal(calc.pricePerMeter, 50);
  assert.ok(calc.total !== null);
  assert.ok(Math.abs((calc.cost ?? 0) - calc.total! * cable.quantity * 50) < 1e-6);

  // Учебный проект уже со стоимостью: у всех демо-кабелей цена 38 ₽/м,
  // поэтому и цена, и стоимость попадают в журнал числом.
  const demo = createDemoProject();
  assert.ok(demo.cables.every(item => item.pricePerMeter === 38), 'в демо у всех кабелей цена 38 ₽/м');
  assert.ok(demo.cables.every(item => calculateCable(demo, item).cost !== null), 'в демо стоимость считается');
  const demoJournal = exportSheets(demo)[0];
  for (const row of demoJournal.rows.slice(1)) {
    assert.equal(row[16], 38, 'колонка «Цена, ₽/м» = 38');
    assert.ok(typeof row[17] === 'number' && Number.isFinite(row[17]), 'колонка «Стоимость, ₽» — число');
  }

  const noPrice = createDemoProject();
  for (const item of noPrice.cables) delete item.pricePerMeter;
  assert.equal(calculateCable(noPrice, noPrice.cables[0]).cost, null, 'без цены стоимость неизвестна, а не ноль');

  const broken = createDemoProject();
  broken.cables[0].pricePerMeter = 50;
  broken.cables[0].quantity = 0;
  assert.equal(calculateCable(broken, broken.cables[0]).cost, null, 'неполный расчёт не даёт стоимость');

  const priceRow = exportSheets(project)[0].rows[1];
  assert.equal(priceRow[16], 50);
  assert.ok(typeof priceRow[17] === 'number');
});

test('CSV содержит диаметр, сечение и раздел заполнения лотков', () => {
  const project = createDemoProject();
  const csv = clientCsv(project);
  assert.ok(csv.startsWith('\uFEFF'));
  const lines = csv.split('\r\n');
  const journalHeader = lines.find(line => line.startsWith('"Номер";"Наименование"'));
  assert.ok(journalHeader, 'нет заголовка кабельного журнала');
  assert.ok(journalHeader.includes('"Диаметр, мм"'), 'в CSV нет колонки диаметра');
  assert.ok(journalHeader.includes('"Сечение, мм²"'), 'в CSV нет колонки сечения');
  const journalHeaderIndex = lines.indexOf(journalHeader);
  const journalRow = lines[journalHeaderIndex + 1].split(';');
  assert.equal(journalRow[3], '"6"', 'у кабеля демо-проекта диаметр 6 мм');
  assert.ok(journalRow[4].startsWith('"28.2'), 'сечение должно считаться по диаметру');

  const start = lines.indexOf('"Заполнение лотков"');
  assert.ok(start > 0, 'в CSV нет раздела заполнения лотков');
  assert.equal(lines[start + 1], '"Трасса";"Сегмент";"Лоток, мм";"Линий";"Площадь кабелей, мм²";"Заполнение, %";"Статус"');
  const segments = project.routes.reduce((sum, route) => sum + route.segments.length, 0);
  assert.equal(lines.length - (start + 2), segments, 'в CSV должна быть строка на каждый сегмент');
  const fillRow = lines[start + 2].split(';');
  assert.ok(Number(fillRow[5].slice(1, -1)) > 0, 'в демо-проекте заполнение должно быть положительным');
  assert.ok(['"ок"', '"внимание"', '"превышено"'].includes(fillRow[6]), `неожиданный статус ${fillRow[6]}`);
});

test('незаданные размеры выгружаются как null/пусто, а не как 0', () => {
  const project = bareProject();
  const sheets = exportSheets(project);
  const journal = sheets[0];
  assert.deepEqual(journal.rows[0].slice(2, 5), ['Марка', 'Диаметр, мм', 'Сечение, мм²']);
  assert.equal(journal.rows[1][3], null, 'неизвестный диаметр — null, не 0');
  assert.equal(journal.rows[1][4], null, 'неизвестное сечение — null, не 0');

  const fill = sheets.find(sheet => sheet.name === 'Заполнение лотков')!;
  assert.equal(fill.rows.length, 2);
  assert.equal(fill.rows[1][4], null, 'площадь лотка неизвестна — null');
  assert.equal(fill.rows[1][7], null, 'заполнение неизвестно — null');
  assert.equal(fill.rows[1][8], 'неполный');

  const infrastructure = sheets.find(sheet => sheet.name === 'Инфраструктура')!;
  assert.equal(infrastructure.rows[1][4], null, 'максимальное заполнение неизвестно — null');
  assert.equal(infrastructure.rows[1][5], 0, 'сегментов с превышением действительно 0');

  const workbook = XLSX.read(buildWorkbook(sheets), { type: 'array' });
  const journalRows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets['Кабельный журнал'], { defval: '' });
  assert.equal(journalRows[0]['Диаметр, мм'], '');
  assert.equal(journalRows[0]['Сечение, мм²'], '');
  const fillRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Заполнение лотков'], { header: 1, defval: '' });
  assert.equal(fillRows[1][7], '');
  assert.equal(fillRows[1][8], 'неполный');

  const lines = clientCsv(project).split('\r\n');
  const start = lines.indexOf('"Заполнение лотков"');
  assert.ok(start > 0);
  const cells = lines[start + 2].split(';');
  assert.equal(cells[5], '""', 'неизвестное заполнение в CSV пустое, не 0');
  assert.equal(cells[6], '"неполный"');
});

test('PDF содержит подписи составителя и проверяющего', async () => {
  const project = createDemoProject();
  project.document = { compiledBy: 'Иванов И.И.', checkedBy: 'Петров П.П.' };
  const bytes = await buildJournalPdf(project, fonts);
  const { text } = await pdfText(bytes);
  assert.ok(text.includes('Составил'));
  assert.ok(text.includes('Проверил'));
  assert.ok(text.includes('Иванов И.И.'));
  assert.ok(text.includes('Петров П.П.'));
  assert.ok(text.includes('Итого кабеля по журналу'));
});

test('PDF прикладывает фотографии оборудования с подписью', async () => {
  const project = createDemoProject();
  const png = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ));
  const equipment = project.equipment[0];
  const bytes = await buildJournalPdf(project, fonts, {
    photos: [{ number: equipment.number, name: equipment.name, data: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength), mime: 'image/png' }],
  });
  const { text } = await pdfText(bytes);
  assert.ok(text.includes('Фотографии оборудования'));
  assert.ok(text.includes(equipment.number));
});

test('PDF прикладывает план этажа и подписывает листы', async () => {
  const project = createDemoProject();
  const png = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ));
  const bytes = await buildJournalPdf(project, fonts, { plans: [{ title: project.floors[0].name, png }] });
  const { text } = await pdfText(bytes);
  assert.ok(text.includes(`План: ${project.floors[0].name}`), 'нет раздела с планом');
  assert.ok(text.includes('Лист 1 из'), 'нет подписи листа');
  assert.ok(text.includes(project.name), 'нет названия проекта в колонтитуле');
});

test('PDF пустого проекта не падает и сообщает об отсутствии записей', async () => {
  const bytes = await buildJournalPdf(emptyProject(), fonts);
  const { text } = await pdfText(bytes);
  assert.ok(text.includes('Нет записей'));
  assert.ok(text.includes('Пустой проект'));
  assert.ok(text.includes('Заполнение лотков'), 'секция заполнения должна быть и в пустом проекте');
});
