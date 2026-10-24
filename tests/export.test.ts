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
import { estimate } from '../src/estimate';
import type { Project } from '../src/model';

const toArrayBuffer = (path: string): ArrayBuffer => {
  const buffer = readFileSync(new URL(path, import.meta.url));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
};

const fonts: JournalFonts = {
  regular: toArrayBuffer('../src/assets/fonts/PT_Sans-Web-Regular.ttf'),
  bold: toArrayBuffer('../src/assets/fonts/PT_Sans-Web-Bold.ttf'),
};

const SHEETS = ['Кабельный журнал', 'Оборудование', 'Кабели', 'Инфраструктура', 'Заполнение лотков', 'Смета', 'Коммерческое предложение', 'Справочник цен', 'Замечания', 'Предупреждения'];
const ESTIMATE_HEADER = ['Раздел', 'Позиция', 'Ед.', 'Количество', 'Цена, ₽', 'Сумма, ₽', 'Источник цены', 'Примечание'];
const COMMERCIAL_HEADER = ['Раздел', 'Сумма, ₽'];
const CATALOG_HEADER = ['Вид', 'Наименование', 'Ед.', 'Цена, ₽', 'Примечание'];

/** PDF-текст: любые пробельные разделители (nbsp) сводим к обычному пробелу для сравнения. */
const squash = (value: string): string => value.replace(/\s+/g, ' ');
const pdfNumber = (value: number | null): string => squash(formatNumber(value));
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

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number; pageTexts: string[] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const document = await task.promise;
  const pageTexts: string[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map(item => ('str' in item ? item.str : '')).join(' '));
  }
  const pages = document.numPages;
  await task.destroy();
  return { text: pageTexts.join('\n'), pages, pageTexts };
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
  const [, , , , , smeta, commercial, catalog] = sheets;
  assert.deepEqual(smeta.rows[0], ESTIMATE_HEADER);
  assert.deepEqual(commercial.rows[0], ['Проект', 'Учебный проект']);
  assert.deepEqual(commercial.rows[4], COMMERCIAL_HEADER);
  assert.deepEqual(catalog.rows[0], CATALOG_HEADER);
  assert.equal(catalog.rows.length, createDemoProject().catalog!.length + 1);
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

  // Смета: математика та же, что у движка, и сходится по JSON round-trip XLSX.
  const estimateResult = estimate(project);
  const materialSections = estimateResult.sections.filter(section => section.kind !== 'work');
  const worksLabel = `Работы (${project.estimate!.laborPercent} %)`;
  const smeta = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Смета'], { header: 1, defval: '' });
  assert.deepEqual(smeta[0], ESTIMATE_HEADER);
  const expectedRows = 1 + materialSections.reduce((sum, section) => sum + section.lines.length, 0) + materialSections.length + 3;
  assert.equal(smeta.length, expectedRows, 'в смете по строке на позицию материального раздела, на его итог и три итоговые строки');
  const rowByLabel = (label: string) => smeta.find(row => row[1] === label);
  assert.equal(rowByLabel('Итого по смете')?.[5], estimateResult.total, 'итог сметы в XLSX равен estimate().total');
  assert.equal(rowByLabel('Итого материалы')?.[5], estimateResult.materials);
  assert.equal(rowByLabel('Итого материалы')?.[6], '', 'у материалов нет источника цены');
  const laborRow = rowByLabel(worksLabel);
  assert.ok(laborRow, `нет строки работ «${worksLabel}»`);
  assert.equal(laborRow![4], '', 'у работ колонка «Цена, ₽» пустая');
  assert.equal(laborRow![5], estimateResult.labor, 'стоимость работ — в колонке «Сумма, ₽»');
  assert.equal(laborRow![6], '', 'у работ колонка «Источник цены» пустая');
  assert.ok(!smeta.some(row => row[1] === 'Итого: Работы'), 'раздел работ не дублируется строкой «Итого: Работы»');
  const equipmentLine = smeta.find(row => row[1] === 'Камера входа')!;
  assert.equal(equipmentLine[0], 'Оборудование');
  assert.equal(equipmentLine[2], 'шт');
  assert.equal(equipmentLine[4], 6500, 'цена камеры входа из демо-справочника');
  assert.equal(equipmentLine[6], 'справочник');
  const cableLine = smeta.find(row => String(row[1]).startsWith('Л1 ·'))!;
  assert.equal(cableLine[2], 'м');
  assert.equal(cableLine[4], 38, 'ручная цена кабеля из демо');
  assert.equal(cableLine[6], 'вручную', 'ручная цена приоритетнее справочника');
  for (const section of materialSections) {
    const totalRow = rowByLabel(`Итого: ${section.title}`);
    assert.ok(totalRow, `нет строки итога раздела «${section.title}»`);
    assert.equal(totalRow[0], '');
    assert.equal(totalRow[5], section.total, `итог раздела «${section.title}»`);
  }
  assert.ok(!smeta.some(row => String(row[1]).startsWith('Итого: Работы')), 'у раздела работ нет отдельного итога: только строка «Работы (N %)»');

  // Коммерческое предложение — короткая сводка с датой прайса и итогом.
  const commercial = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Коммерческое предложение'], { header: 1, defval: '' });
  assert.deepEqual(commercial[0], ['Проект', project.name]);
  assert.deepEqual(commercial[1], ['Дата прайса', project.catalogDate]);
  assert.deepEqual(commercial[2], ['Примечание', project.estimate!.note]);
  const commercialHeaderIndex = commercial.findIndex(row => row[0] === 'Раздел' && row[1] === 'Сумма, ₽');
  assert.ok(commercialHeaderIndex > 0, 'нет шапки коммерческого предложения');
  const commercialRow = (label: string) => commercial.find(row => row[0] === label);
  assert.equal(commercialRow('Итого')?.[1], estimateResult.total);
  assert.equal(commercialRow('Итого материалы')?.[1], estimateResult.materials);
  assert.equal(commercialRow(worksLabel)?.[1], estimateResult.labor);
  const commercialSections = commercial.slice(commercialHeaderIndex + 1, commercial.indexOf(commercialRow('Итого материалы')!)).map(row => row[0]);
  assert.deepEqual(commercialSections, materialSections.map(section => section.title), 'в КП только материальные разделы: работы идут отдельной строкой');
  assert.ok(!commercial.some(row => row[0] === 'Работы'), 'раздел «Работы» не дублируется в КП');

  // Справочник цен с русскими видами позиций и ценами демо.
  const catalog = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Справочник цен'], { header: 1, defval: '' });
  assert.deepEqual(catalog[0], CATALOG_HEADER);
  assert.equal(catalog.length, project.catalog!.length + 1);
  const camera = catalog.find(row => row[1] === 'Камера входа')!;
  assert.deepEqual(camera, ['Оборудование', 'Камера входа', 'шт', 6500, '']);
  assert.deepEqual(catalog.find(row => row[1] === 'КВК-П 2×0.75'), ['Кабель', 'КВК-П 2×0.75', 'м', 38, '']);
  assert.deepEqual(catalog.find(row => row[1] === 'Стояк'), ['Лоток', 'Стояк', 'м', 620, '']);
  for (const row of catalog.slice(1)) {
    assert.ok(['Оборудование', 'Кабель', 'Лоток'].includes(String(row[0])), `неизвестный вид позиции: ${String(row[0])}`);
  }
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

  // Смета и коммерческое предложение — те же данные, что в XLSX, с датой прайса.
  const estimateResult = estimate(project);
  const normalized = squash(text);
  assert.ok(text.includes('Смета'), 'нет секции сметы');
  assert.ok(text.includes('Коммерческое предложение'), 'нет секции коммерческого предложения');
  assert.ok(text.includes('Итого по смете'), 'нет итога по смете');
  assert.ok(text.includes('Итого материалы'), 'нет итога по материалам');
  assert.ok(text.includes('Дата прайса: '), 'нет даты прайса в смете');
  assert.ok(normalized.includes(`Дата прайса: ${project.catalogDate}`), 'в PDF нет фактической даты прайса');
  assert.ok(normalized.includes(project.estimate!.note!), 'в PDF нет примечания к смете');
  assert.ok(normalized.includes(`Работы (${project.estimate!.laborPercent} %)`), 'в PDF нет процента работ');
  assert.ok(!normalized.includes('Итого: Работы'), 'в PDF работы не дублируются строкой «Итого: Работы»');
  assert.ok(normalized.includes(pdfNumber(estimateResult.total)), `в PDF нет итога сметы ${formatNumber(estimateResult.total)}`);
  assert.ok(normalized.includes(pdfNumber(estimateResult.materials)), `в PDF нет материалов ${formatNumber(estimateResult.materials)}`);
  assert.ok(normalized.includes(pdfNumber(estimateResult.labor)), `в PDF нет стоимости работ ${formatNumber(estimateResult.labor)}`);
  assert.ok(normalized.includes('6 500'), 'в смете PDF нет цены камеры из справочника');
  assert.ok(text.includes('Оборудование') && text.includes('Кабели') && text.includes('Лотки'), 'в PDF нет разделов сметы');
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
  const fillRows = lines.slice(start + 2, start + 2 + segments);
  assert.equal(fillRows.length, segments, 'в CSV должна быть строка на каждый сегмент');
  assert.equal(lines[start + 2 + segments], '', 'после заполнения лотков идёт пустая строка перед сметой');
  const fillRow = fillRows[0].split(';');
  assert.ok(Number(fillRow[5].slice(1, -1)) > 0, 'в демо-проекте заполнение должно быть положительным');
  assert.ok(['"ок"', '"внимание"', '"превышено"'].includes(fillRow[6]), `неожиданный статус ${fillRow[6]}`);

  // Новые разделы: смета, коммерческое предложение и справочник цен.
  for (const name of ['Смета', 'Коммерческое предложение', 'Справочник цен']) assert.ok(lines.includes(`"${name}"`), `в CSV нет раздела «${name}»`);
  const estimateResult = estimate(project);
  const smetaStart = lines.indexOf('"Смета"');
  assert.equal(lines[smetaStart + 1], '"Раздел";"Позиция";"Ед.";"Количество";"Цена, ₽";"Сумма, ₽";"Источник цены";"Примечание"');
  const smetaTotal = lines.find(line => line.startsWith('"";"Итого по смете"'));
  assert.ok(smetaTotal, 'в CSV нет итога по смете');
  assert.equal(smetaTotal!.split(';')[5], `"${estimateResult.total}"`, 'итог сметы в CSV равен estimate().total');
  assert.equal(smetaTotal!.split(';')[4], '""', 'неизвестное количество в CSV пустое, а не 0');
  assert.ok(lines.some(line => line.startsWith('"Оборудование";"Камера входа";"шт";"6500";')), 'в CSV-смете нет позиции из справочника');
  const worksLine = lines.find(line => line.startsWith('"";"Работы (25 %)"'));
  assert.ok(worksLine, 'в CSV-смете нет строки работ «Работы (25 %)»');
  const worksCells = worksLine!.split(';');
  assert.equal(worksCells[4], '""', 'у работ колонка «Цена, ₽» пустая');
  assert.equal(worksCells[5], `"${estimateResult.labor}"`, 'стоимость работ — в колонке «Сумма, ₽»');
  assert.equal(worksCells[6], '""', 'у работ колонка «Источник цены» пустая');
  assert.ok(!lines.some(line => line.startsWith('"";"Итого: Работы"')), 'раздел работ не дублируется в CSV');
  const commercialStart = lines.indexOf('"Коммерческое предложение"');
  assert.equal(lines[commercialStart + 1], `"Проект";"${project.name}"`);
  assert.equal(lines[commercialStart + 2], `"Дата прайса";"${project.catalogDate}"`);
  assert.ok(lines.includes(`"Итого";"${estimateResult.total}"`), 'в CSV-КП нет итога');
  const kpHeaderIndex = lines.findIndex((line, index) => index > commercialStart && line === '"Раздел";"Сумма, ₽"');
  assert.ok(kpHeaderIndex > commercialStart, 'в CSV-КП нет шапки');
  const kpMaterialsIndex = lines.findIndex((line, index) => index > kpHeaderIndex && line.startsWith('"Итого материалы";'));
  assert.ok(kpMaterialsIndex > kpHeaderIndex, 'в CSV-КП нет строки материалов');
  assert.deepEqual(lines.slice(kpHeaderIndex + 1, kpMaterialsIndex).map(line => line.split(';')[0]), ['"Оборудование"', '"Кабели"', '"Лотки"'], 'в КП только материальные разделы');
  assert.ok(!lines.some(line => line === `"Работы";"${estimateResult.labor}"`), 'раздел «Работы» не дублируется в КП');
  const catalogStart = lines.indexOf('"Справочник цен"');
  assert.equal(lines[catalogStart + 1], '"Вид";"Наименование";"Ед.";"Цена, ₽";"Примечание"');
  assert.ok(lines.slice(catalogStart + 2).includes('"Оборудование";"Камера входа";"шт";"6500";""'), 'в CSV-справочнике нет позиции демо');
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
  const { text, pages } = await pdfText(bytes);
  assert.ok(text.includes(`План: ${project.floors[0].name}`), 'нет раздела с планом');
  assert.ok(text.includes('Листов'), 'нет штампа с числом листов');
  assert.ok(text.includes(`Лист ${pages}`), 'нет номера последнего листа');
  assert.ok(text.includes('Лист 1 из'), 'нет подписи титульного листа');
  assert.ok(text.includes(project.name), 'нет названия проекта в колонтитуле');
});

test('PDF пустого проекта не падает и сообщает об отсутствии записей', async () => {
  const bytes = await buildJournalPdf(emptyProject(), fonts);
  const { text } = await pdfText(bytes);
  assert.ok(text.includes('Нет записей'));
  assert.ok(text.includes('Пустой проект'));
  assert.ok(text.includes('Заполнение лотков'), 'секция заполнения должна быть и в пустом проекте');
});

test('смета демо сходится: материалы + работы = итог, предупреждений нет', () => {
  const project = createDemoProject();
  const result = estimate(project);
  assert.equal(result.complete, true, 'демо-смета должна быть полной');
  assert.ok(result.materials !== null && result.materials > 0);
  assert.ok(result.labor !== null && result.labor > 0);
  assert.ok(result.total !== null && result.total > 0);
  assert.ok(Math.abs(result.total - (result.materials + result.labor)) < 1e-9, 'итог = материалы + работы');
  assert.ok(Math.abs(result.labor - result.materials * project.estimate!.laborPercent! / 100) < 1e-9, 'работы = процент от материалов');
  assert.equal(result.catalogDate, project.catalogDate, 'дата прайса берётся из проекта');
  assert.deepEqual(result.warnings, [], 'в полной демо-смете предупреждений нет');
  const sheets = exportSheets(project);
  const warnings = sheets.find(sheet => sheet.name === 'Предупреждения')!;
  assert.deepEqual(warnings.rows, [['Предупреждение']], 'лист предупреждений пуст: нет цен-заглушек и ошибок');
  const smeta = sheets.find(sheet => sheet.name === 'Смета')!;
  assert.ok(!smeta.rows.some(row => row[1] === 'Итого: Работы'), 'нет дублирующей строки «Итого: Работы»');
  const worksRow = smeta.rows.find(row => row[1] === `Работы (${project.estimate!.laborPercent} %)`)!;
  assert.equal(worksRow[4], '', 'цена работ пустая');
  assert.equal(worksRow[5], result.labor, 'стоимость работ в «Сумма, ₽»');
  assert.equal(worksRow[6], '', 'источник цены пустой');
  assert.equal(smeta.rows.at(-3)![1], 'Итого материалы');
  assert.equal(smeta.rows.at(-2)![1], `Работы (${project.estimate!.laborPercent} %)`);
  assert.equal(smeta.rows.at(-1)![1], 'Итого по смете');
});

test('без справочника цен и процента работ смета неполная: «—» и предупреждение, а не 0', async () => {
  const project = createDemoProject();
  delete project.catalog;
  delete project.catalogDate;
  delete project.estimate;
  const result = estimate(project);
  assert.equal(result.complete, false);
  assert.equal(result.materials, null);
  assert.equal(result.labor, null);
  assert.equal(result.total, null);
  assert.equal(result.laborPercent, null);
  assert.equal(result.catalogDate, null);
  assert.ok(result.warnings.some(w => w.includes('нет цены в справочнике')), 'нет предупреждения об отсутствии цены');
  assert.ok(result.warnings.some(w => w.includes('не задан процент работ')), 'нет предупреждения о проценте работ');

  const sheets = exportSheets(project);
  const smeta = sheets.find(sheet => sheet.name === 'Смета')!;
  const rowByLabel = (label: string) => smeta.rows.find(row => row[1] === label)!;
  assert.equal(rowByLabel('Итого по смете')[5], null, 'неизвестный итог — null, не 0');
  assert.equal(rowByLabel('Итого материалы')[5], null, 'неизвестные материалы — null, не 0');
  const laborRow = rowByLabel('Работы (не задан)');
  assert.equal(laborRow[4], '', 'у работ колонка «Цена, ₽» пустая, а не 0');
  assert.equal(laborRow[5], null, 'работы не рассчитаны — null, не 0');
  assert.equal(laborRow[6], '', 'у работ колонка «Источник цены» пустая');
  assert.ok(!smeta.rows.some(row => row[1] === 'Итого: Работы'), 'раздел работ не дублируется');
  const equipmentRow = smeta.rows.find(row => row[1] === 'Камера входа')!;
  assert.equal(equipmentRow[4], null, 'неизвестная цена — null, не 0');
  assert.equal(equipmentRow[5], null);
  assert.equal(equipmentRow[6], null, 'источник цены неизвестен');

  const warningsSheet = sheets.find(sheet => sheet.name === 'Предупреждения')!;
  const warnings = warningsSheet.rows.slice(1).map(row => String(row[0]));
  for (const warning of result.warnings) assert.ok(warnings.includes(warning), `нет предупреждения: ${warning}`);
  assert.ok(warnings.some(warning => warning.includes('Камера входа')), 'предупреждение об отсутствии цены должно называть позицию');

  const commercial = sheets.find(sheet => sheet.name === 'Коммерческое предложение')!;
  assert.deepEqual(commercial.rows[1], ['Дата прайса', '—'], 'без даты прайса — «—», не 0');
  assert.equal(commercial.rows.find(row => row[0] === 'Итого')![1], null, 'итог КП неизвестен, а не 0');
  assert.equal(commercial.rows.find(row => row[0] === 'Работы (не задан)')![1], null, 'работы неизвестны — null, не 0');
  assert.ok(!commercial.rows.some(row => row[0] === 'Работы'), 'раздел «Работы» не дублируется в КП');

  const lines = clientCsv(project).split('\r\n');
  assert.ok(lines.includes('"Дата прайса";"—"'), 'в CSV нет «—» вместо даты');
  const csvTotal = lines.find(line => line.startsWith('"";"Итого по смете"'))!;
  assert.equal(csvTotal.split(';')[5], '""', 'неизвестный итог в CSV пустой, не 0');
  assert.ok(!lines.some(line => /"Итого по смете";"";"";"";"0"/.test(line)), 'итог не подменяется нулём');
  const csvWorks = lines.find(line => line.startsWith('"";"Работы (не задан)"'));
  assert.ok(csvWorks, 'в CSV-смете нет строки «Работы (не задан)»');
  assert.equal(csvWorks!.split(';')[5], '""', 'неизвестные работы в CSV пустые, не 0');
  assert.ok(!lines.some(line => line.startsWith('"";"Итого: Работы"')), 'раздел работ не дублируется в CSV');

  // PDF: неизвестные значения — «—», предупреждения сметы попадают в раздел предупреждений.
  const { text } = await pdfText(await buildJournalPdf(project, fonts));
  assert.ok(text.includes('Итого по смете'), 'нет сметы в PDF');
  assert.ok(text.includes('—'), 'нет прочерков вместо неизвестных значений');
  assert.ok(text.includes('не задан процент работ'), 'нет предупреждения сметы в PDF');
  assert.ok(text.includes('нет цены в справочнике'), 'нет предупреждения о цене в PDF');
  assert.ok(text.includes('Работы (не задан)'), 'в PDF-смете нет строки «Работы (не задан)»');
  assert.ok(!text.includes('Итого: Работы'), 'в PDF работы не дублируются');
});


test('PDF: титульный лист с реквизитами документа', async () => {
  const project = createDemoProject();
  const document = project.document!;
  const { pageTexts, text } = await pdfText(await buildJournalPdf(project, fonts));
  const title = pageTexts[0];
  for (const value of [document.organization!, document.object!, document.documentCode!, document.title!, document.compiledBy!, document.checkedBy!]) {
    assert.ok(title.includes(value), `на титульном листе нет «${value}»`);
  }
  assert.ok(title.includes('Екатеринбург · 2026'), 'на титуле нет города и года');
  assert.ok(title.includes('Составил') && title.includes('Проверил'), 'на титуле нет блока подписей');
  assert.ok(title.includes(`Дата: ${document.date}`), 'на титуле нет даты документа');
  assert.ok(!title.includes('Разраб.'), 'на титульном листе не должно быть штампа');
  assert.ok(text.includes(project.name), 'название проекта не попало в PDF');
  assert.ok(pageTexts.length > 3, 'титул, оглавление и разделы должны занимать больше страниц');
});

test('PDF: оглавление с названиями разделов и фактическими номерами страниц', async () => {
  const project = createDemoProject();
  const { pageTexts } = await pdfText(await buildJournalPdf(project, fonts));
  const contents = pageTexts[1];
  assert.ok(contents.includes('Оглавление'), 'нет страницы оглавления');
  const expected = ['Кабельный журнал', 'Оборудование', 'Кабельная продукция', 'Кабельная инфраструктура', 'Заполнение лотков', 'Смета', 'Коммерческое предложение', 'Замечания', 'Лист регистрации изменений'];
  for (const title of expected) {
    assert.ok(contents.includes(title), `в оглавлении нет «${title}»`);
    const after = contents.slice(contents.indexOf(title) + title.length);
    const match = /^\s*(\d+)/.exec(after);
    assert.ok(match, `у «${title}» нет номера страницы в оглавлении`);
    const tocPage = Number(match![1]);
    const actualPage = pageTexts.findIndex((page, index) => index >= 2 && page.includes(title)) + 1;
    assert.ok(actualPage > 2, `раздел «${title}» не найден в содержимом`);
    assert.equal(tocPage, actualPage, `неверный номер страницы для «${title}»`);
  }
});

test('PDF: штамп ГОСТ 2.104 на каждой странице кроме титула', async () => {
  const project = createDemoProject();
  const { pageTexts } = await pdfText(await buildJournalPdf(project, fonts));
  const labels = ['Изм.', 'Лист', '№ докум.', 'Подп.', 'Дата', 'Разраб.', 'Пров.', 'Т.контр.', 'Н.контр.', 'Утв.', 'Листов'];
  for (let index = 1; index < pageTexts.length; index += 1) {
    for (const label of labels) {
      assert.ok(pageTexts[index].includes(label), `на странице ${index + 1} нет поля «${label}»`);
    }
    assert.ok(pageTexts[index].includes(`Лист ${index + 1}`), `неверный номер листа на странице ${index + 1}`);
    assert.ok(pageTexts[index].includes(`Листов ${pageTexts.length}`), `неверное число листов на странице ${index + 1}`);
  }
  assert.ok(!pageTexts[0].includes('Разраб.'), 'на титульном листе не должно быть штампа');
});

test('PDF: лист регистрации изменений с записями демо и без записей', async () => {
  const project = createDemoProject();
  const changes = project.document!.changeLog!;
  const { text } = await pdfText(await buildJournalPdf(project, fonts));
  assert.ok(text.includes('Лист регистрации изменений'), 'нет листа регистрации изменений');
  for (const entry of changes) {
    assert.ok(text.includes(entry.description), `нет описания изменения «${entry.description}»`);
    assert.ok(text.includes(entry.author), `нет автора изменения «${entry.author}»`);
    assert.ok(text.includes(entry.date), `нет даты изменения «${entry.date}»`);
  }
  const noChanges = createDemoProject();
  noChanges.document = { ...noChanges.document, changeLog: [] };
  const { text: emptyText } = await pdfText(await buildJournalPdf(noChanges, fonts));
  assert.ok(emptyText.includes('Изменений нет.'), 'без записей должно быть «Изменений нет.»');
});

test('PDF: include фильтрует печатаемые разделы и сокращает документ', async () => {
  const project = createDemoProject();
  const full = await pdfText(await buildJournalPdf(project, fonts));
  const journalOnly = await pdfText(await buildJournalPdf(project, fonts, { include: ['journal'] }));
  assert.ok(journalOnly.pages < full.pages, 'с фильтром разделов страниц должно быть меньше');
  assert.ok(journalOnly.text.includes('Кабельный журнал'), 'выбранный раздел не напечатан');
  for (const absent of ['Оборудование', 'Заполнение лотков', 'Коммерческое предложение', 'Лист регистрации изменений', 'Итого по смете']) {
    assert.ok(!journalOnly.text.includes(absent), `раздел/строка «${absent}» не должны печататься`);
  }
  assert.ok(!journalOnly.pageTexts[1].includes('Смета'), 'оглавление должно фильтроваться вместе с разделами');
  assert.ok(journalOnly.pageTexts[1].includes('Кабельный журнал'), 'в оглавлении нет выбранного раздела');
});

test('PDF: include:[] — титул, оглавление и страница итогов/подписей', async () => {
  const project = createDemoProject();
  const { pages, pageTexts, text } = await pdfText(await buildJournalPdf(project, fonts, { include: [] }));
  assert.equal(pages, 3, 'титул, оглавление и страница итогов/подписей');
  assert.ok(pageTexts[0].includes(project.document!.organization!), 'на титуле нет организации');
  assert.ok(pageTexts[1].includes('Оглавление'), 'нет оглавления');
  assert.ok(pageTexts[1].includes('Разделы не выбраны.'), 'пустое оглавление должно быть явным');
  for (const absent of ['Оборудование', 'Смета', 'Заполнение лотков', 'Лист регистрации изменений']) {
    assert.ok(!pageTexts[1].includes(absent), `в оглавлении не должно быть «${absent}»`);
    assert.ok(!pageTexts[2].includes(absent), `на странице итогов не должно быть раздела «${absent}»`);
  }
  assert.ok(text.includes('Итого кабеля по журналу'), 'итоги печатаются всегда');
  assert.ok(text.includes('Составил'), 'подписи печатаются всегда');
});
