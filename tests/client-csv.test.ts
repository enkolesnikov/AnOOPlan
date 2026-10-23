import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoProject } from '../src/demo';
import { clientCsv } from '../src/client-csv';

test('CSV начинается с BOM и содержит журнал и ведомости', () => {
  const csv = clientCsv(createDemoProject());
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"Кабельный журнал"'));
  assert.ok(csv.includes('"Оборудование"'));
  assert.ok(csv.includes('"Инфраструктура"'));
  assert.ok(csv.split('\r\n').length > 10);
});

test('CSV экранирует кавычки и формулы', () => {
  const project = createDemoProject();
  project.cables[0].name = '=SUM(A1:A2)';
  project.cables[0].brand = 'Кабель "Тест"';
  const csv = clientCsv(project);
  assert.ok(csv.includes(`"'=SUM(A1:A2)"`), 'формула должна быть обезврежена');
  assert.ok(csv.includes('"Кабель ""Тест"""'), 'кавычки должны удваиваться');
});
