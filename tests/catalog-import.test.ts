import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCatalog, parseCatalogRows, parseKindCell, parsePriceCell } from '../src/catalog-import';
import type { PriceItem } from '../src/model';

const rows = [
  ['Вид', 'Наименование', 'Артикул', 'Производитель', 'Серия', 'Размер', 'Ед.', 'Цена', 'Примечание'],
  ['Оборудование', 'Шкаф питания', 'SH-1', 'DKC', 'Шкафы', '600×400', 'шт', '28 500,50 ₽', 'основной'],
  ['Кабель', 'КВК-П 2×0.75', 'KVK-1', 'Спецкабель', 'КВК', '2×0.75', 'м', '38', ''],
  ['КНС', 'Лоток', 'L-100', 'DKC', 'Лоток', '100×50', 'м', '480', ''],
  ['', '', '', '', '', '', '', '', ''],
  ['Оборудование', '', '', '', '', '', '', '', ''],
];

test('импорт: цена и вид позиции', () => {
  assert.equal(parsePriceCell('28 500,50 ₽'), 28500.5);
  assert.equal(parsePriceCell(''), null);
  assert.ok(Number.isNaN(parsePriceCell('дорого')));
  assert.equal(parseKindCell('Оборудование'), 'equipment');
  assert.equal(parseKindCell('Кабель'), 'cable');
  assert.equal(parseKindCell('Кабель-канал'), 'tray');
  assert.equal(parseKindCell('Лоток'), 'tray');
  assert.equal(parseKindCell(''), 'equipment');
});

test('импорт: разбор таблицы и отчёт об ошибках', () => {
  const result = parseCatalogRows(rows);
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].name, 'Шкаф питания');
  assert.equal(result.items[0].price, 28500.5);
  assert.equal(result.items[0].series, 'Шкафы');
  assert.equal(result.items[0].size, '600×400');
  assert.equal(result.items[1].unit, 'м');
  assert.equal(result.items[2].kind, 'tray');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Строка 6: не указано наименование/);
});

test('импорт: английские заголовки и цена-мусор', () => {
  const result = parseCatalogRows([
    ['Kind', 'Name', 'Price', 'Unit'],
    ['cable', 'UTP cat5e', '12,5', 'm'],
    ['equipment', 'Switch', 'n/a', 'pcs'],
  ]);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].price, 12.5);
  assert.equal(result.items[1].price, null);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /не число/);
});

test('импорт: merge обновляет существующие и добавляет новые', () => {
  const existing: PriceItem[] = [{ id: 'old', kind: 'equipment', name: 'Шкаф питания', unit: 'шт', price: 100, note: '', article: 'A' }];
  const incoming = parseCatalogRows(rows).items;
  const result = mergeCatalog(existing, incoming);
  assert.equal(result.added, 2);
  assert.equal(result.updated, 1);
  const updated = result.catalog.find(item => item.id === 'old')!;
  assert.equal(updated.price, 28500.5);
  assert.equal(updated.article, 'SH-1');
  assert.equal(result.catalog.length, 3);
});
