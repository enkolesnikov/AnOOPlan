import test from 'node:test';
import assert from 'node:assert/strict';
import { exportSheets } from '../src/sheets';
import { clientCsv } from '../src/client-csv';
import { safeFileBaseName } from '../src/project-file';
import type { Project } from '../src/model';

/** Проект с кабелем «витая пара» длиной 120 м: доменное предупреждение о пределе 100 м. */
function longTwistedPairProject(): Project {
  return {
    schemaVersion: 2, id: 'p', name: 'UTP', updatedAt: '2026-01-01T00:00:00Z',
    floors: [{ id: 'f1', name: 'Этаж 1', elevation: 0, metersPerUnit: 1, page: 1, width: 200, height: 100 }],
    equipment: [
      { id: 'e1', number: 'Ш1', name: 'Шкаф', type: 'Шкаф', floorId: 'f1', x: 0, y: 0, height: 0, note: '', properties: {} },
      { id: 'e2', number: 'К1', name: 'Камера', type: 'Камера', floorId: 'f1', x: 120, y: 0, height: 3, note: '', properties: {} },
    ],
    routes: [{
      id: 'r1', number: 'Т1', type: 'Лоток', note: '',
      segments: [{
        id: 's1',
        a: { id: 'v1', floorId: 'f1', x: 0, y: 0, height: 2.5 },
        b: { id: 'v2', floorId: 'f1', x: 120, y: 0, height: 2.5 },
        mode: 'orthogonal', reservePercent: 0, reserveFixed: 0,
      }],
    }],
    cables: [{
      id: 'c1', number: 'Л1', name: 'Камера', brand: 'UTP cat5e', purpose: 'Видеонаблюдение',
      fromId: 'e1', toId: 'e2', segmentIds: ['s1'], reservePercent: 0, reserveFixed: 0,
      startReserve: 0, endReserve: 0, quantity: 1, pricePerMeter: 10, note: '',
    }],
    pins: [],
  };
}

const warningRows = (project: Project): string[] => {
  const sheet = exportSheets(project).find(item => item.name === 'Предупреждения');
  assert.ok(sheet, 'нет листа «Предупреждения»');
  return sheet!.rows.slice(1).map(row => String(row[0]));
};

test('лист «Предупреждения» включает доменные предупреждения', () => {
  const warnings = warningRows(longTwistedPairProject());
  assert.ok(
    warnings.some(warning => warning.includes('витая пара длиннее 100 м')),
    `нет доменного предупреждения о витой паре: ${warnings.join(' | ')}`,
  );
  assert.equal(new Set(warnings).size, warnings.length, 'предупреждения не должны дублироваться');
});

test('лист «Предупреждения» не выдумывает предупреждения на полном проекте', () => {
  const warnings = warningRows(longTwistedPairProject());
  assert.ok(!warnings.some(warning => warning.includes('не задана цена за метр')), `ложное предупреждение о цене: ${warnings.join(' | ')}`);
  assert.ok(!warnings.some(warning => warning.includes('стоимость не рассчитана')), `ложное предупреждение о стоимости: ${warnings.join(' | ')}`);
});

test('лист «Предупреждения» сообщает об отсутствующей цене кабеля', () => {
  const project = longTwistedPairProject();
  delete project.cables[0].pricePerMeter;
  const warnings = warningRows(project);
  assert.ok(
    warnings.some(warning => warning.includes('не задана цена за метр')),
    `нет предупреждения о цене кабеля: ${warnings.join(' | ')}`,
  );
  assert.equal(new Set(warnings).size, warnings.length, 'предупреждения не должны дублироваться');
});

test('повреждённое количество не попадает в журнал/CSV как «NaN»', () => {
  const project = longTwistedPairProject();
  project.cables[0].quantity = Number.NaN;
  const journal = exportSheets(project).find(sheet => sheet.name === 'Кабельный журнал')!;
  assert.equal(journal.rows[1][8], null, 'количество в XLSX-листе — пусто, а не NaN');
  assert.equal(journal.rows[1][14], null, 'итог с количеством — пусто, а не NaN');
  const csv = clientCsv(project);
  assert.doesNotMatch(csv, /NaN|Infinity/, 'CSV не должен содержать NaN/Infinity');
});

test('безопасное базовое имя файла: пустое, пробельное и с запрещёнными символами', () => {
  assert.equal(safeFileBaseName(''), 'Проект');
  assert.equal(safeFileBaseName('   '), 'Проект');
  assert.equal(safeFileBaseName('Отчёт №1/2026'), 'Отчёт №1-2026');
  assert.equal(safeFileBaseName('  Проект  '), 'Проект', 'пробелы по краям срезаются');
  assert.ok(!/[\\/:*?"<>|]/.test(safeFileBaseName('a\\b/c:d*e?f"g<h>i|j')));
  assert.ok(safeFileBaseName('я'.repeat(500)).length <= 120, 'длинное имя обрезается');

  for (const extension of ['.csv', '.xlsx', '.pdf', '.json', '.anooplan']) {
    const name = `${safeFileBaseName('Отчёт №1/2026')}${extension}`;
    assert.ok(name.endsWith(extension), `потеряно расширение ${extension}: ${name}`);
    assert.ok(!name.slice(0, -extension.length).includes('/'), `слэш в имени: ${name}`);
    assert.equal(`${safeFileBaseName('   ')}${extension}`, `Проект${extension}`, 'пустое имя даёт «Проект» с расширением');
  }
});
