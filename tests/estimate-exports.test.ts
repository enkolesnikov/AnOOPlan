import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { exportSheets } from '../src/sheets';
import { clientCsv } from '../src/client-csv';
import { buildWorkbook } from '../src/export-xlsx';
import { estimate } from '../src/estimate';
import { createDemoProject } from '../src/demo';
import { baseProject, cable, device, floor, priceItem, route, segment, vertex } from './fixtures';
import type { Project } from '../src/model';

/**
 * XLSX/CSV сметы 2.10.0: работы по видам, НДС и округление.
 *
 * Эталонные числа посчитаны вручную и зашиты в тесты, а не вычисляются той же
 * функцией, что и выгрузка: материалы 21 000 (2×8 000 + 10×100 + 10×400),
 * работы по видам 26 600 (120×180 + 5×800 + 1 000), итог до НДС 47 600,
 * НДС 20 % — 9 520, итог с НДС — 57 120.
 */

const ESTIMATE_HEADER = ['Раздел', 'Позиция', 'Ед.', 'Количество', 'Цена, ₽', 'Сумма, ₽', 'Источник цены', 'Примечание'];

/**
 * Проект для выгрузки: два устройства Д-1 (2×8 000), кабель 10 м × 100 (вручную),
 * лоток 10 м × 400. Итог материалов — 21 000 ₽.
 */
function exportProject(): Project {
  return baseProject({
    name: 'Выгрузка сметы',
    catalogDate: '2026-01-15',
    floors: [floor('f1', { name: 'Первый' })],
    equipment: [
      device('a', 0, { number: 'A', name: 'Устройство A', properties: { model: 'Д-1' } }),
      device('b', 100, { number: 'B', name: 'Устройство B', properties: { model: 'Д-1' } }),
    ],
    routes: [route('r', [segment('s1', vertex('v1', 0, 0, 1), vertex('v2', 100, 0, 1))])],
    cables: [cable({ id: 'c1', number: 'К1', brand: 'ВВГ', segmentIds: ['s1'], pricePerMeter: 100 })],
    catalog: [
      priceItem('e1', { name: 'Д-1', price: 8000 }),
      priceItem('t1', { kind: 'tray', name: 'Лоток', unit: 'м', price: 400 }),
    ],
  });
}

/** Работы по видам: 120 м × 180 + 5 точек × 800 + 1 компл × 1 000 = 26 600 ₽. */
const WORKS = [
  { id: 'w1', name: 'Прокладка лотка', unit: 'м', quantity: 120, price: 180 },
  { id: 'w2', name: 'Монтаж точки', unit: 'точка', quantity: 5, price: 800 },
  { id: 'w3', name: 'Пусконаладка', unit: 'компл', quantity: 1, price: 1000 },
];

/** Работы по видам, НДС 20 % сверху и округление до рубля. */
function itemsProject(): Project {
  const project = exportProject();
  project.estimate = {
    works: WORKS,
    note: 'Цены действительны 30 дней',
    laborPercent: 25,
    vatRate: 20,
    vatIncluded: false,
    rounding: 1,
  };
  return project;
}

/** Обратная совместимость: проценты работ 25 % без НДС и без работ по видам. */
function percentProject(): Project {
  const project = exportProject();
  project.catalog = [
    priceItem('e1', { name: 'Д-1', price: 5000 }),
    priceItem('t1', { kind: 'tray', name: 'Лоток', unit: 'м', price: 480 }),
  ];
  project.cables[0].pricePerMeter = 50;
  project.estimate = { laborPercent: 25 };
  return project;
}

const sheetRows = (project: Project, name: string): unknown[][] =>
  exportSheets(project).find(sheet => sheet.name === name)!.rows as unknown[][];

const rowByLabel = (rows: unknown[][], label: string): unknown[] | undefined => rows.find(row => row[1] === label);

test('XLSX «Смета»: работы по видам, НДС 20 % и округление в строках листа', () => {
  const project = itemsProject();
  const result = estimate(project);
  // Числа теста — эталон вручную; estimate() обязан дать те же значения.
  assert.equal(result.materials, 21000);
  assert.equal(result.labor, 26600);
  assert.equal(result.total, 47600);
  assert.equal(result.vat, 9520);
  assert.equal(result.gross, 57120);
  assert.equal(result.worksMode, 'items');
  assert.equal(result.rounding, 1);

  // Читаем лист обратно из собранного XLSX: проверяем результат, а не только модель.
  const workbook = XLSX.read(buildWorkbook(exportSheets(project)), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Смета'], { header: 1, defval: '' });
  assert.deepEqual(rows[0], ESTIMATE_HEADER);

  // Строки работ — обычные позиции раздела «Работы» с источником «вручную».
  assert.deepEqual(rows.find(row => row[1] === 'Прокладка лотка'), ['Работы', 'Прокладка лотка', 'м', 120, 180, 21600, 'вручную', '']);
  assert.deepEqual(rows.find(row => row[1] === 'Монтаж точки'), ['Работы', 'Монтаж точки', 'точка', 5, 800, 4000, 'вручную', '']);
  assert.deepEqual(rows.find(row => row[1] === 'Пусконаладка'), ['Работы', 'Пусконаладка', 'компл', 1, 1000, 1000, 'вручную', '']);
  assert.equal(rowByLabel(rows, 'Итого: Работы')?.[5], 26600);

  // Итоги: материалы, работы (по видам), до НДС, НДС, с НДС.
  assert.equal(rowByLabel(rows, 'Итого материалы')?.[5], 21000);
  assert.equal(rowByLabel(rows, 'Работы (по видам)')?.[5], 26600);
  assert.equal(rowByLabel(rows, 'Итого до НДС')?.[5], 47600);
  assert.equal(rowByLabel(rows, 'НДС 20 %')?.[5], 9520);
  assert.equal(rowByLabel(rows, 'Итого с НДС')?.[5], 57120);
  assert.ok(!rows.some(row => row[1] === 'Итого по смете'), 'с НДС итог называется «Итого до НДС» + «Итого с НДС»');
  assert.ok(!rows.some(row => row[1] === 'Работы (не задан)'), 'в режиме видов нет подписи «Работы (не задан)»');

  // Округление — строкой-примечанием в конце листа.
  assert.deepEqual(rows.at(-1), ['', 'Округление: до 1 ₽', '', '', '', '', '', '']);
});

test('XLSX «Коммерческое предложение»: те же итоги и примечание о НДС', () => {
  const project = itemsProject();
  const rows = sheetRows(project, 'Коммерческое предложение');
  assert.deepEqual(rows[0], ['Проект', 'Выгрузка сметы']);
  assert.deepEqual(rows[1], ['Дата прайса', '2026-01-15']);

  assert.deepEqual(rows.find(row => row[0] === 'Итого материалы'), ['Итого материалы', 21000]);
  assert.deepEqual(rows.find(row => row[0] === 'Работы (по видам)'), ['Работы (по видам)', 26600]);
  assert.deepEqual(rows.find(row => row[0] === 'Итого до НДС'), ['Итого до НДС', 47600]);
  assert.deepEqual(rows.find(row => row[0] === 'НДС 20 %'), ['НДС 20 %', 9520]);
  assert.deepEqual(rows.find(row => row[0] === 'Итого с НДС'), ['Итого с НДС', 57120]);
  assert.ok(rows.some(row => row[0] === 'Цены без НДС'), 'в КП нет примечания «Цены без НДС»');
  assert.ok(!rows.some(row => row[0] === 'Итого'), 'итог с НДС не подписан просто «Итого»');
  // В КП по-прежнему только материальные разделы: работы идут отдельной строкой.
  const header = rows.findIndex(row => row[0] === 'Раздел' && row[1] === 'Сумма, ₽');
  const materials = rows.findIndex(row => row[0] === 'Итого материалы');
  assert.deepEqual(rows.slice(header + 1, materials).map(row => row[0]), ['Оборудование', 'Кабели', 'Лотки']);
});

test('CSV: те же строки сметы и итоги с НДС', () => {
  const lines = clientCsv(itemsProject()).split('\r\n');
  const start = lines.indexOf('"Смета"');
  assert.ok(start > 0, 'в CSV нет раздела «Смета»');
  assert.equal(lines[start + 1], '"Раздел";"Позиция";"Ед.";"Количество";"Цена, ₽";"Сумма, ₽";"Источник цены";"Примечание"');
  assert.ok(lines.includes('"Работы";"Прокладка лотка";"м";"120";"180";"21600";"вручную";""'), 'в CSV нет строки работ');
  assert.ok(lines.includes('"";"Итого: Работы";"";"";"";"26600";"";""'), 'в CSV нет итога раздела работ');
  assert.ok(lines.includes('"";"Итого материалы";"";"";"";"21000";"";""'));
  assert.ok(lines.includes('"";"Работы (по видам)";"";"";"";"26600";"";""'));
  assert.ok(lines.includes('"";"Итого до НДС";"";"";"";"47600";"";""'));
  assert.ok(lines.includes('"";"НДС 20 %";"";"";"";"9520";"";""'));
  assert.ok(lines.includes('"";"Итого с НДС";"";"";"";"57120";"";""'));
  assert.ok(lines.includes('"";"Округление: до 1 ₽";"";"";"";"";"";""'), 'в CSV нет строки округления');
  assert.ok(lines.includes('"Итого до НДС";"47600"'), 'в CSV-КП нет итога до НДС');
  assert.ok(lines.includes('"НДС 20 %";"9520"'), 'в CSV-КП нет НДС');
  assert.ok(lines.includes('"Итого с НДС";"57120"'), 'в CSV-КП нет итога с НДС');
  assert.ok(lines.includes('"Цены без НДС"'), 'в CSV-КП нет примечания о НДС');
});

test('обратная совместимость: режим процента без НДС даёт прежние строки', () => {
  const project = percentProject();
  const result = estimate(project);
  // Эталон вручную: 2×5 000 + 10×50 + 10×480 = 15 300; работы 25 % = 3 825; итог 19 125.
  assert.equal(result.materials, 15300);
  assert.equal(result.labor, 3825);
  assert.equal(result.total, 19125);
  assert.equal(result.worksMode, 'percent');

  const rows = sheetRows(project, 'Смета');
  assert.equal(rowByLabel(rows, 'Итого материалы')?.[5], 15300);
  assert.equal(rowByLabel(rows, 'Работы (25 %)')?.[5], 3825);
  assert.equal(rowByLabel(rows, 'Итого по смете')?.[5], 19125);
  assert.ok(!rows.some(row => row[1] === 'Итого: Работы'), 'в режиме процента раздел работ не дублируется');
  assert.ok(!rows.some(row => row[1] === 'Итого до НДС'), 'без НДС итог — прежний «Итого по смете»');
  assert.ok(!rows.some(row => String(row[1]).startsWith('НДС')), 'без НДС нет строки налога');
  assert.ok(!rows.some(row => String(row[1]).startsWith('Округление')), 'без округления нет строки-примечания');
  assert.ok(!rows.some(row => row[0] === 'Работы'), 'в режиме процента у работ нет позиций');

  const commercial = sheetRows(project, 'Коммерческое предложение');
  assert.deepEqual(commercial.find(row => row[0] === 'Работы (25 %)'), ['Работы (25 %)', 3825]);
  assert.deepEqual(commercial.find(row => row[0] === 'Итого'), ['Итого', 19125]);
  assert.ok(!commercial.some(row => row[0] === 'Итого до НДС'), 'без НДС в КП прежняя строка «Итого»');
  assert.ok(!commercial.some(row => String(row[0]).startsWith('НДС')), 'без НДС в КП нет строки налога');
  assert.ok(commercial.some(row => row[0] === 'Цены без НДС'), 'в КП есть примечание «Цены без НДС»');
});

test('НДС включён в цены: «НДС 20 % (в т.ч.)» и «Цены с НДС»', () => {
  const project = itemsProject();
  project.estimate = { ...project.estimate!, vatIncluded: true };
  const result = estimate(project);
  // Эталон вручную: НДС из 47 600 × 20 / 120 = 7 933,33… → 7 933 при округлении до рубля.
  assert.equal(result.total, 47600);
  assert.equal(result.vat, 7933);
  assert.equal(result.gross, 47600);

  const rows = sheetRows(project, 'Смета');
  assert.equal(rowByLabel(rows, 'НДС 20 % (в т.ч.)')?.[5], 7933);
  assert.equal(rowByLabel(rows, 'Итого с НДС')?.[5], 47600);
  const commercial = sheetRows(project, 'Коммерческое предложение');
  assert.deepEqual(commercial.find(row => row[0] === 'НДС 20 % (в т.ч.)'), ['НДС 20 % (в т.ч.)', 7933]);
  assert.ok(commercial.some(row => row[0] === 'Цены с НДС'), 'в КП нет примечания «Цены с НДС»');
});

test('демо-проект без НДС сохраняет прежнюю строку «Итого по смете»', () => {
  const project = createDemoProject();
  const result = estimate(project);
  const rows = sheetRows(project, 'Смета');
  assert.equal(result.vatRate, null);
  assert.equal(rowByLabel(rows, 'Итого по смете')?.[5], result.total, 'без НДС подпись итога прежняя');
  assert.ok(!rows.some(row => String(row[1]).startsWith('НДС')), 'в демо нет начисленного НДС');
  assert.ok(rows.some(row => row[1] === `Работы (${project.estimate!.laborPercent} %)`), 'строка процента работ на месте');
});
