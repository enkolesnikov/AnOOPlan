import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildWorkbook, freezeHeaderRows } from '../src/export-xlsx';
import { addFrozenPane } from '../src/xlsx-freeze';
import { exportSheets } from '../src/sheets';
import { createDemoProject } from '../src/demo';
import { baseProject } from './fixtures';

const SHEETS = ['Кабельный журнал', 'Оборудование', 'Кабели', 'Схема трасс', 'Спецификация КНС', 'Инфраструктура', 'Заполнение КНС', 'Смета', 'Коммерческое предложение', 'Справочник цен', 'Замечания', 'Предупреждения'];

/** Распаковать deflate-raw: тот же поток, каким xlsx-freeze сжимает лист обратно. */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Прочитать файл из ZIP по имени, идя по локальным заголовкам.
 * Тестовая копия мини-читателя: специально не переиспользует код правки,
 * чтобы проверять результат, а не ту же самую логику.
 */
async function readZipEntry(bytes: Uint8Array, wanted: string): Promise<string | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    if (name === wanted) {
      if (method === 0) return new TextDecoder().decode(data);
      if (method === 8) return new TextDecoder().decode(await inflateRaw(data));
      return null;
    }
    offset = dataStart + compressedSize;
  }
  return null;
}

function workbookSheet(bytes: Uint8Array, name: string): XLSX.WorkSheet {
  // cellStyles нужен, чтобы Community-редакция разобрала !cols и !rows обратно.
  const workbook = XLSX.read(bytes, { type: 'array', cellStyles: true });
  const sheet = workbook.Sheets[name];
  assert.ok(sheet, `нет листа «${name}»`);
  return sheet as XLSX.WorkSheet;
}

test('ширины колонок, автофильтр и высота шапки записываются в книгу', () => {
  const bytes = buildWorkbook(exportSheets(createDemoProject()));
  const workbook = XLSX.read(bytes, { type: 'array' });
  assert.deepEqual(workbook.SheetNames, SHEETS);

  const journal = workbookSheet(bytes, 'Кабельный журнал');
  const cols = journal['!cols'] as XLSX.ColInfo[];
  assert.ok(Array.isArray(cols), 'у журнала нет !cols');
  assert.equal(cols.length, 21, 'ширина задана для всех 21 колонки журнала');
  for (const [index, column] of cols.entries()) {
    assert.ok(typeof column.wch === 'number' && column.wch > 0, `колонка ${index + 1} без ширины`);
    assert.ok(column.wch! >= 8 && column.wch! <= 48, `ширина колонки ${index + 1} вне диапазона: ${column.wch}`);
  }
  // Деньги и метры — числа: ширина не растягивается значениями свыше 24,
  // но и шапка не обрезается.
  for (const index of [3, 4, 9, 10, 14, 16, 17]) {
    assert.ok(cols[index].wch! <= 24, `числовая колонка ${index + 1} шире 24: ${cols[index].wch}`);
  }
  assert.ok(cols[15].wch! >= 'Итог с количеством, м'.length, 'длинная шапка числовой колонки обрезана');

  const rows = journal['!rows'] as XLSX.RowInfo[];
  assert.ok(Array.isArray(rows), 'у журнала нет !rows');
  assert.equal(rows[0].hpt, 30, 'высота шапки 30 пунктов');

  const filter = journal['!autofilter'] as XLSX.AutoFilterInfo;
  assert.ok(filter, 'у журнала нет автофильтра');
  assert.match(filter.ref, /^A1:U\d+$/, 'автофильтр должен покрывать шапку журнала');

  // Сам файл: CE пишет autoFilter в лист и _xlnm._FilterDatabase в workbook.xml.
  // Неизменённые записи архива хранятся без сжатия, поэтому текст виден в байтах.
  const raw = new TextDecoder().decode(bytes);
  assert.match(raw, /<autoFilter ref="A1:U\d+"\/>/, 'в XML листа нет autoFilter');
  assert.ok(raw.includes('_xlnm._FilterDatabase'), 'в workbook.xml нет определённого имени фильтра');
  assert.match(raw, /<row r="1"[^>]*ht="30"/, 'в XML нет высоты строки шапки');
});

test('freezeHeaderRows закрепляет шапку и сохраняет данные книги', async () => {
  const project = createDemoProject();
  const sheets = exportSheets(project);
  const original = buildWorkbook(sheets);
  const frozen = await freezeHeaderRows(original);
  assert.notEqual(frozen, original, 'закрепление должно изменить архив');

  for (let index = 1; index <= sheets.length; index += 1) {
    const xml = await readZipEntry(frozen, `xl/worksheets/sheet${index}.xml`);
    assert.ok(xml, `нет XML листа ${index}`);
    // Количество закреплённых строк — шапка таблицы: fromRow + 1.
    const frozenRows = (sheets[index - 1].table?.fromRow ?? 0) + 1;
    assert.ok(xml!.includes(`<pane ySplit="${frozenRows}" topLeftCell="A${frozenRows + 1}" activePane="bottomLeft" state="frozen"/>`), `лист ${index} без закреплённой шапки (${frozenRows} строк)`);
    assert.equal((xml!.match(/<pane\b/g) ?? []).length, 1, `на листе ${index} несколько pane`);
  }

  const workbook = XLSX.read(frozen, { type: 'array' });
  assert.deepEqual(workbook.SheetNames, SHEETS, 'после закрепления набор листов тот же');
  const journal = workbookSheet(frozen, 'Кабельный журнал');
  assert.equal(journal['A2']?.v, sheets[0].rows[1][0], 'первое значение журнала сохранилось');
  const before = XLSX.utils.sheet_to_json<unknown[]>(workbookSheet(original, 'Кабельный журнал'), { header: 1, defval: '' });
  const after = XLSX.utils.sheet_to_json<unknown[]>(journal, { header: 1, defval: '' });
  assert.deepEqual(after, before, 'данные журнала не изменились');

  const smeta = workbookSheet(frozen, 'Смета');
  assert.equal(smeta['A2']?.v, sheets.find(sheet => sheet.name === 'Смета')!.rows[1][0]);
});

test('автофильтр не накрывает итоги и служебные строки, числа остаются числами', async () => {
  const project = createDemoProject();
  project.cables[0].quantity = 1000;
  const sheets = exportSheets(project);
  const bytes = buildWorkbook(sheets);
  const workbook = XLSX.read(bytes, { type: 'array', cellNF: true, cellStyles: true });

  // «Смета» и «Спецификация КНС»: итоги стоят среди данных — автофильтра нет,
  // но закрепление и ширины остаются.
  for (const name of ['Смета', 'Спецификация КНС']) {
    const sheet = workbook.Sheets[name];
    assert.equal(sheet['!autofilter'], undefined, `у листа «${name}» не должно быть автофильтра`);
    const cols = sheet['!cols'] as XLSX.ColInfo[];
    assert.ok(Array.isArray(cols) && cols.length > 0, `у листа «${name}» нет ширин колонок`);
  }

  // «Коммерческое предложение»: фильтр начинается со строки шапки, а не с A1,
  // и заканчивается перед пустой строкой и примечанием о НДС.
  const commercialRows = sheets.find(sheet => sheet.name === 'Коммерческое предложение')!.rows;
  const headerRow = commercialRows.findIndex(row => row[0] === 'Раздел' && row[1] === 'Сумма, ₽');
  const totalRow = commercialRows.findIndex(row => row[0] === 'Итого' || row[0] === 'Итого с НДС');
  assert.ok(headerRow > 0, 'шапка КП должна быть не в первой строке');
  assert.ok(totalRow > headerRow, 'в КП должны быть итоговые строки');
  const commercial = workbook.Sheets['Коммерческое предложение'];
  assert.equal((commercial['!autofilter'] as XLSX.AutoFilterInfo).ref, `A${headerRow + 1}:B${totalRow + 1}`);
  assert.equal(commercialRows[totalRow + 1].length, 0, 'перед примечанием о НДС должна быть пустая строка');

  // «Схема трасс»: фильтр заканчивается на последней трассе, «Итого по типам» — вне его.
  const scheme = workbook.Sheets['Схема трасс'];
  assert.equal((scheme['!autofilter'] as XLSX.AutoFilterInfo).ref, `A1:F${project.routes.length + 1}`);

  // «Кабельный журнал»: внутри диапазона фильтра нет ни одной строки «Итого».
  const journal = workbook.Sheets['Кабельный журнал'];
  const range = XLSX.utils.decode_range((journal['!autofilter'] as XLSX.AutoFilterInfo).ref);
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const value = journal[XLSX.utils.encode_cell({ r: row, c: column })]?.v;
      assert.ok(!(typeof value === 'string' && value.startsWith('Итого')), `строка «Итого» попала в фильтр журнала (строка ${row + 1})`);
    }
  }

  // Количества и деньги — числа, деньги — с форматом «#,##0.00».
  const quantity = journal['J2'];
  assert.equal(quantity.t, 'n', 'количество должно быть числом');
  assert.equal(typeof quantity.v, 'number');
  assert.equal(quantity.v, 1000);
  for (const address of ['Q2', 'R2']) {
    const cell = journal[address];
    assert.equal(cell.t, 'n', `${address}: деньги должны быть числом`);
    assert.equal(typeof cell.v, 'number');
    assert.equal(cell.z, '#,##0.00', `${address}: нет денежного формата`);
  }
  const smeta = workbook.Sheets['Смета'];
  assert.equal(smeta['E2'].t, 'n', 'цена в смете должна быть числом');
  assert.equal(smeta['E2'].z, '#,##0.00', 'цена в смете без денежного формата');

  // Денежная колонка не растянута до 48, но шапка влезает.
  const journalCols = journal['!cols'] as XLSX.ColInfo[];
  assert.ok(journalCols[16].wch! >= 'Цена, ₽/м'.length);
  assert.ok(journalCols[16].wch! <= 24);
  assert.ok(journalCols[15].wch! >= 'Итог с количеством, м'.length, 'шапка числовой колонки обрезана');

  // Закрепление: у КП закреплены реквизиты и шапка (5 строк), данные — с A6.
  const frozen = await freezeHeaderRows(bytes);
  const kpXml = await readZipEntry(frozen, 'xl/worksheets/sheet9.xml');
  assert.ok(kpXml?.includes('<pane ySplit="5" topLeftCell="A6"'), 'у КП должно быть закреплено 5 строк');
  const smetaXml = await readZipEntry(frozen, 'xl/worksheets/sheet8.xml');
  assert.ok(smetaXml?.includes('<pane ySplit="1" topLeftCell="A2"'), 'у сметы закреплена первая строка');
});

test('закрепление идемпотентно и не ломает нестандартный sheetView', () => {
  const selfClosing = '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const frozen = addFrozenPane(selfClosing);
  assert.equal((frozen.match(/<pane\b/g) ?? []).length, 1);
  assert.equal(addFrozenPane(frozen), frozen, 'повторная правка не дублирует pane');

  const withSelection = '<sheetViews><sheetView workbookViewId="0"><selection activeCell="B2" sqref="B2"/></sheetView></sheetViews>';
  const patched = addFrozenPane(withSelection);
  assert.ok(patched.includes('<pane ySplit="1" topLeftCell="A2"'));
  assert.ok(patched.indexOf('<pane') < patched.indexOf('<selection'), 'pane должен идти перед selection');
  assert.ok(patched.includes('<selection activeCell="B2" sqref="B2"/>'), 'selection сохранён');
});

test('журнал, спецификация КНС и смета — отдельные листы с короткими уникальными именами', () => {
  const workbook = XLSX.read(buildWorkbook(exportSheets(createDemoProject())), { type: 'array' });
  for (const name of ['Кабельный журнал', 'Спецификация КНС', 'Смета']) assert.ok(workbook.SheetNames.includes(name), `нет листа «${name}»`);
  assert.equal(new Set(workbook.SheetNames).size, workbook.SheetNames.length, 'имена листов должны быть уникальны');
  for (const name of workbook.SheetNames) assert.ok(name.length <= 31, `имя листа длиннее 31 символа: ${name}`);

  // Обрезка длинных имён не должна давать дубль: Excel такой файл не откроет.
  const long = 'Очень длинное имя листа для проверки'.slice(0, 30);
  const collision = XLSX.read(buildWorkbook([
    { name: `${long}1`, rows: [['A']] },
    { name: `${long}2`, rows: [['A']] },
    { name: '', rows: [['A']] },
  ]), { type: 'array' });
  assert.equal(new Set(collision.SheetNames).size, 3, 'коллизии после обрезки не устранены');
  for (const name of collision.SheetNames) assert.ok(name.length <= 31, `имя после обрезки длиннее 31: ${name}`);
});

test('пустой проект: книга собирается, автофильтр только по шапке', async () => {
  const project = baseProject({ cables: [], routes: [], equipment: [], pins: [] });
  const sheets = exportSheets(project);
  const journalRows = sheets.find(sheet => sheet.name === 'Кабельный журнал')!.rows;
  assert.equal(journalRows.length, 1, 'в пустом проекте у журнала только шапка');

  const bytes = buildWorkbook(sheets);
  const journal = workbookSheet(bytes, 'Кабельный журнал');
  const filter = journal['!autofilter'] as XLSX.AutoFilterInfo;
  assert.ok(filter, 'автофильтр должен быть и без строк данных');
  assert.equal(filter.ref, 'A1:U1', 'без данных автофильтр покрывает только шапку');
  const cols = journal['!cols'] as XLSX.ColInfo[];
  assert.equal(cols.length, 21);

  const frozen = await freezeHeaderRows(bytes);
  const xml = await readZipEntry(frozen, 'xl/worksheets/sheet1.xml');
  assert.ok(xml?.includes('topLeftCell="A2"'), 'пустой лист тоже получает закрепление');
  const workbook = XLSX.read(frozen, { type: 'array' });
  assert.deepEqual(workbook.SheetNames, SHEETS);
  const reread = workbookSheet(frozen, 'Кабельный журнал');
  assert.equal(reread['A1']?.v, 'Номер', 'шапка журнала сохранилась');
});
