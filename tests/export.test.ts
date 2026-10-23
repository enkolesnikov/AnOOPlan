import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { exportSheets } from '../src/sheets';
import { buildWorkbook } from '../src/export-xlsx';
import { buildJournalPdf } from '../src/export-pdf';
import type { JournalFonts } from '../src/export-fonts';
import { createDemoProject } from '../src/demo';
import { calculateCable } from '../src/engine';
import type { Project } from '../src/model';

const toArrayBuffer = (path: string): ArrayBuffer => {
  const buffer = readFileSync(new URL(path, import.meta.url));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
};

const fonts: JournalFonts = {
  regular: toArrayBuffer('../src/assets/fonts/PT_Sans-Web-Regular.ttf'),
  bold: toArrayBuffer('../src/assets/fonts/PT_Sans-Web-Bold.ttf'),
};

const emptyProject = (): Project => ({
  schemaVersion: 1, id: 'p', name: 'Пустой проект', updatedAt: '2026-01-01T00:00:00Z',
  floors: [{ id: 'f1', name: 'Этаж 1', elevation: 0, metersPerUnit: 1, page: 1, width: 1000, height: 700 }],
  equipment: [], routes: [], cables: [],
});

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
  assert.deepEqual(sheets.map(sheet => sheet.name), ['Кабельный журнал', 'Оборудование', 'Кабели', 'Инфраструктура', 'Предупреждения']);
  const [journal, equipment] = sheets;
  assert.equal(journal.rows[0].length, 19);
  assert.equal(journal.rows.length, createDemoProject().cables.length + 1);
  assert.deepEqual(equipment.rows[0], ['Тип', 'Модель', 'Этаж', 'Количество']);
});

test('XLSX собирается в приложении и читается обратно', () => {
  const project = createDemoProject();
  const bytes = buildWorkbook(exportSheets(project));
  assert.ok(bytes.length > 5000, `файл неожиданно маленький: ${bytes.length}`);
  const workbook = XLSX.read(bytes, { type: 'array' });
  assert.deepEqual(workbook.SheetNames, ['Кабельный журнал', 'Оборудование', 'Кабели', 'Инфраструктура', 'Предупреждения']);
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets['Кабельный журнал'], { defval: '' });
  assert.equal(rows.length, project.cables.length);
  assert.ok(rows.some(row => row['Номер'] === project.cables[0].number));
  assert.ok(rows.every(row => 'Итог одного, м' in row));
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
  assert.ok(text.includes('Итого, м'), 'нет колонки итога');
  assert.ok(text.includes('полный') || text.includes('неполный'), 'нет статуса расчёта');
  assert.ok(!text.includes('\uFFFD'), 'в тексте есть неизвестные глифы');
});

test('смета считается по цене за метр и не подменяется нулём', () => {
  const project = createDemoProject();
  const cable = project.cables[0];
  cable.pricePerMeter = 50;
  const calc = calculateCable(project, cable);
  assert.equal(calc.pricePerMeter, 50);
  assert.ok(calc.total !== null);
  assert.ok(Math.abs((calc.cost ?? 0) - calc.total! * cable.quantity * 50) < 1e-6);

  const noPrice = createDemoProject();
  assert.equal(calculateCable(noPrice, noPrice.cables[0]).cost, null, 'без цены стоимость неизвестна, а не ноль');

  const broken = createDemoProject();
  broken.cables[0].pricePerMeter = 50;
  broken.cables[0].quantity = 0;
  assert.equal(calculateCable(broken, broken.cables[0]).cost, null, 'неполный расчёт не даёт стоимость');

  const priceRow = exportSheets(project)[0].rows[1];
  assert.equal(priceRow[14], 50);
  assert.ok(typeof priceRow[15] === 'number');
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
});
