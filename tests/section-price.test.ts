import test from 'node:test';
import assert from 'node:assert/strict';
import { estimate } from '../src/estimate';
import { specificationKnS } from '../src/engine';
import { normalizePriceSize } from '../src/engine/specification';
import type { PriceItem, Project, Route } from '../src/model';
import { baseProject, floor, priceItem, route, segment, vertex } from './fixtures';

/** Проект без оборудования и кабелей: в смете остаются только лотки. */
function project(routes: Route[], catalog: PriceItem[]): Project {
  return baseProject({
    name: 'Сечения',
    floors: [floor('f1', { name: 'Первый' })],
    equipment: [],
    cables: [],
    routes,
    catalog,
    estimate: { laborPercent: 0 },
  });
}

/** Цена лотка с необязательным сечением и артикулом. */
const trayPrice = (id: string, size: string | undefined, price: number | null, article = ''): PriceItem =>
  priceItem(id, {
    kind: 'tray', name: 'Лоток', unit: 'м', price,
    ...(size === undefined ? {} : { size }),
    ...(article ? { article } : {}),
  });

test('два сечения одного типа — две строки с разными ценами и верной суммой', () => {
  const p = project([
    route('r1', [segment('s1', vertex('a', 0), vertex('b', 100))], { type: 'Лоток', trayWidthMm: 100, trayHeightMm: 50 }),
    route('r2', [segment('s2', vertex('c', 0), vertex('d', 50))], { type: 'Лоток', trayWidthMm: 50, trayHeightMm: 50 }),
  ], [
    trayPrice('p100', '100×50', 480),
    trayPrice('p50', '50×50', 300),
  ]);

  const trays = estimate(p).sections[2];
  assert.deepEqual(trays.lines.map(line => [line.id, line.name, line.quantity, line.price, line.total]), [
    ['tray:Лоток:100×50', 'Лоток · 100×50', 10, 480, 4800],
    ['tray:Лоток:50×50', 'Лоток · 50×50', 5, 300, 1500],
  ]);
  assert.equal(trays.total, 6300);
  assert.equal(trays.complete, true);
});

test('сечения нет в прайсе: цена null и предупреждение с сечением, а не первая цена', () => {
  const p = project([
    route('r1', [segment('s1', vertex('a', 0), vertex('b', 50))], { type: 'Лоток', trayWidthMm: 50, trayHeightMm: 50 }),
  ], [
    trayPrice('p100', '100×50', 480),
  ]);

  const trays = estimate(p).sections[2];
  assert.equal(trays.lines.length, 1);
  const [line] = trays.lines;
  assert.equal(line.id, 'tray:Лоток:50×50');
  assert.equal(line.name, 'Лоток · 50×50');
  assert.equal(line.quantity, 5);
  assert.equal(line.price, null, 'цена чужого сечения не подставляется');
  assert.equal(line.total, null);
  assert.equal(trays.total, null);
  assert.equal(trays.complete, false);
  assert.ok(
    trays.warnings.includes('Смета: для «Лоток» нет цены сечения 50×50 в справочнике'),
    trays.warnings.join('; '),
  );
});

test('позиция без size — универсальная для любого сечения', () => {
  const p = project([
    route('r1', [segment('s1', vertex('a', 0), vertex('b', 100))], { type: 'Лоток', trayWidthMm: 100, trayHeightMm: 50 }),
    route('r2', [segment('s2', vertex('c', 0), vertex('d', 50))], { type: 'Лоток', trayWidthMm: 50, trayHeightMm: 50 }),
  ], [
    trayPrice('universal', undefined, 250),
  ]);

  const trays = estimate(p).sections[2];
  assert.deepEqual(trays.lines.map(line => [line.id, line.price, line.total]), [
    ['tray:Лоток:100×50', 250, 2500],
    ['tray:Лоток:50×50', 250, 1250],
  ]);
  assert.equal(trays.total, 3750);
  assert.deepEqual(trays.warnings, []);
});

test('смета, как и спецификация, допускает цену группы для своего типа', () => {
  const result = estimate(project([route('Т1', [segment('s1', vertex('a', 0, 0), vertex('b', 100, 0))], { type: 'Гофра ПВХ', trayWidthMm: 20 })], [
    priceItem('g1', { kind: 'tray', name: 'Гофра', unit: 'м', price: 50, size: 'Ø20' }),
  ]));
  const line = result.sections.find(section => section.kind === 'tray')!.lines[0];
  assert.equal(line.price, 50, 'цена группы «Гофра» должна найтись для типа «Гофра ПВХ»');
  assert.equal(line.quantity, 10);
  assert.equal(line.total, 500);
});

test('пустая трасса не добавляет строку 0 м и не обнуляет раздел', () => {
  const result = estimate(project([route('Т1', [])], []));
  const traySection = result.sections.find(section => section.kind === 'tray')!;
  assert.deepEqual(traySection.lines, [], 'пустая трасса не должна давать строку материала');
  assert.equal(traySection.total, 0);
  assert.equal(traySection.complete, true);
});

test('normalizePriceSize: регистр, пробелы, x/х/× и диаметр приводятся к одному виду', () => {
  assert.equal(normalizePriceSize('100x50'), normalizePriceSize('100×50'));
  assert.equal(normalizePriceSize('100X50'), normalizePriceSize('100×50'));
  assert.equal(normalizePriceSize('100 х 50'), normalizePriceSize('100×50'));
  assert.equal(normalizePriceSize('Ø 20'), normalizePriceSize('20'));
  assert.equal(normalizePriceSize('d20'), normalizePriceSize('Ø20'));
  assert.equal(normalizePriceSize('S=500 мм²'), normalizePriceSize('s=500 мм2'));
  assert.equal(normalizePriceSize('Диаметр 20'), normalizePriceSize('Ø20'));
});

test('смешанная трасса: 10 м 100×50 по 480 и 5 м 50×50 по 300 дают 4800 + 1500', () => {
  const p = project([
    route('r1', [
      segment('s1', vertex('a', 0), vertex('b', 100)),
      segment('s2', vertex('b', 100), vertex('c', 150), { trayWidthMm: 50, trayHeightMm: 50 }),
    ], { type: 'Лоток', trayWidthMm: 100, trayHeightMm: 50 }),
  ], [
    trayPrice('p100', '100x50', 480),
    trayPrice('p50', '50×50', 300),
  ]);

  const result = estimate(p);
  const trays = result.sections[2];
  assert.deepEqual(trays.lines.map(line => [line.id, line.quantity, line.price, line.total]), [
    ['tray:Лоток:100×50', 10, 480, 4800],
    ['tray:Лоток:50×50', 5, 300, 1500],
  ]);
  assert.equal(trays.total, 6300);
  assert.equal(result.materials, 6300);
  assert.equal(result.total, 6300);
});

test('specificationKnS: цена и артикул берутся для сечения своей строки', () => {
  const p = project([
    route('r1', [
      segment('s1', vertex('a', 0), vertex('b', 100)),
      segment('s2', vertex('b', 100), vertex('c', 150), { trayWidthMm: 50, trayHeightMm: 50 }),
    ], { type: 'Лоток', trayWidthMm: 100, trayHeightMm: 50 }),
  ], [
    trayPrice('p100', '100×50', 480, 'L-100'),
    trayPrice('p50', '50×50', 300, 'L-50'),
  ]);

  const spec = specificationKnS(p);
  const wide = spec.lines.find(line => line.section === '100×50');
  const narrow = spec.lines.find(line => line.section === '50×50');
  assert.ok(wide && narrow);
  assert.deepEqual([wide.quantity, wide.price, wide.article, wide.cost], [10, 480, 'L-100', 4800]);
  assert.deepEqual([narrow.quantity, narrow.price, narrow.article, narrow.cost], [5, 300, 'L-50', 1500]);
  assert.equal(spec.totalCost, 6300);
});
