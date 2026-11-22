import test from 'node:test';
import assert from 'node:assert/strict';
import { specificationKnS } from '../src/engine';
import { exportSheets } from '../src/sheets';
import type { PriceItem, Project, Route } from '../src/model';
import { baseProject, floor, priceItem, route, segment, vertex } from './fixtures';

/** Проект без оборудования и кабелей: в спецификации остаются только КНС. */
function project(routes: Route[], catalog: PriceItem[]): Project {
  return baseProject({
    name: 'КНС по подсистемам',
    floors: [floor('f1', { name: 'Первый' })],
    equipment: [],
    cables: [],
    routes,
    catalog,
    estimate: { laborPercent: 0 },
  });
}

/** Позиция справочника КНС по типу, сечению и артикулу. */
const price = (id: string, name: string, size: string, value: number, article: string): PriceItem =>
  priceItem(id, { kind: 'tray', name, unit: 'м', price: value, size, article });

/** Трасса из двух участков: 10 м по 100×50 и 5 м по 50×50. */
function mixedSectionRoute(extra: Partial<Route> = {}): Route {
  return route('r1', [
    segment('s1', vertex('a', 0), vertex('b', 100)),
    segment('s2', vertex('b', 100), vertex('c', 150), { trayWidthMm: 50, trayHeightMm: 50 }),
  ], { type: 'Лоток', trayWidthMm: 100, trayHeightMm: 50, ...extra });
}

/** Две подсистемы: магистральный лоток и горизонтальные короб с лотком. */
function subsystemsProject(): Project {
  return project([
    route('r1', [segment('s1', vertex('a', 0), vertex('b', 100))], {
      type: 'Лоток', trayWidthMm: 100, trayHeightMm: 50, subsystem: 'trunk',
    }),
    route('r2', [
      segment('s2', vertex('c', 0), vertex('d', 100)),
      segment('s3', vertex('d', 100), vertex('e', 100, 50)),
    ], { type: 'Кабель-канал', trayWidthMm: 100, trayHeightMm: 50, subsystem: 'horizontal' }),
    route('r3', [segment('s4', vertex('f', 0), vertex('g', 50))], {
      type: 'Лоток', trayWidthMm: 50, trayHeightMm: 50, subsystem: 'horizontal',
    }),
  ], [
    price('p100', 'Лоток', '100×50', 480, 'L-100'),
    price('p50', 'Лоток', '50×50', 300, 'L-50'),
    price('pkk', 'Кабель-канал', '100×50', 180, 'KK-100'),
  ]);
}

test('две подсистемы: строки блоками, итоги по подсистемам и типам с ценой и углами', () => {
  const p = subsystemsProject();

  const spec = specificationKnS(p);
  // Подсистема первого появления — магистральная; внутри подсистем тип и сечение упорядочены.
  assert.deepEqual(spec.lines.map(line => [line.subsystem, line.name, line.section, line.quantity, line.angles]), [
    ['Магистральная', 'Лоток', '100×50', 10, 0],
    ['Горизонтальная', 'Кабель-канал', '100×50', 15, 1],
    ['Горизонтальная', 'Лоток', '50×50', 5, 0],
  ]);
  assert.deepEqual(spec.subsystems, [
    { subsystem: 'Магистральная', length: 10, angles: 0, cost: 4800, lines: 1 },
    { subsystem: 'Горизонтальная', length: 20, angles: 1, cost: 4200, lines: 2 },
  ]);
  assert.deepEqual(spec.totals.map(total => [total.group, total.length, total.angles, total.cost]), [
    ['Лоток', 15, 0, 6300],
    ['Кабель-канал', 15, 1, 2700],
  ]);
  assert.equal(spec.totalLength, 30);
  assert.equal(spec.totalCost, 9000);
  // Подытог подсистемы и типа сходится с суммой своих строк, а не считается отдельно.
  for (const group of spec.subsystems) {
    const groupLines = spec.lines.filter(line => line.subsystem === group.subsystem);
    assert.equal(group.cost, groupLines.reduce((sum, line) => sum + (line.cost ?? 0), 0));
    assert.equal(group.angles, groupLines.reduce((sum, line) => sum + line.angles, 0));
  }
  for (const total of spec.totals) {
    const typeLines = spec.lines.filter(line => line.name === total.group);
    assert.equal(total.cost, typeLines.reduce((sum, line) => sum + (line.cost ?? 0), 0));
  }
});

test('смешанные сечения одной трассы: разные строки с артикулами своего сечения', () => {
  const p = project([mixedSectionRoute()], [
    price('p100', 'Лоток', '100×50', 480, 'L-100'),
    price('p50', 'Лоток', '50×50', 300, 'L-50'),
  ]);

  const spec = specificationKnS(p);
  assert.equal(spec.lines.length, 2);
  const bySection = new Map(spec.lines.map(line => [line.section, line]));
  assert.deepEqual([...bySection.keys()].sort(), ['100×50', '50×50']);
  const wide = bySection.get('100×50')!;
  const narrow = bySection.get('50×50')!;
  assert.deepEqual([wide.article, wide.price, wide.quantity, wide.cost], ['L-100', 480, 10, 4800]);
  assert.deepEqual([narrow.article, narrow.price, narrow.quantity, narrow.cost], ['L-50', 300, 5, 1500]);
  assert.notEqual(wide.article, narrow.article, 'артикул не должен переезжать между сечениями');
  assert.equal(spec.totalLength, 15);
  assert.equal(spec.totalCost, 6300);
});

test('нет цены для одного сечения: строка без цены, подытог подсистемы null и предупреждение', () => {
  const p = project([mixedSectionRoute({ subsystem: 'horizontal' })], [
    price('p100', 'Лоток', '100×50', 480, 'L-100'),
  ]);

  const spec = specificationKnS(p);
  assert.equal(spec.lines.length, 2, 'обе строки остаются в спецификации');
  const wide = spec.lines.find(line => line.section === '100×50')!;
  const narrow = spec.lines.find(line => line.section === '50×50')!;
  assert.deepEqual([wide.price, wide.cost, wide.article], [480, 4800, 'L-100']);
  assert.deepEqual([narrow.price, narrow.cost, narrow.article], [null, null, ''], 'чужое сечение не подставляет первую цену');
  assert.deepEqual(spec.subsystems, [
    { subsystem: 'Горизонтальная', length: 15, angles: 0, cost: null, lines: 2 },
  ]);
  assert.equal(spec.totals.find(total => total.group === 'Лоток')?.cost, null);
  assert.equal(spec.totalLength, 15);
  assert.equal(spec.totalCost, null);
  assert.ok(
    spec.warnings.includes('КНС: для «Лоток» нет цены сечения 50×50 в справочнике'),
    spec.warnings.join('; '),
  );
});

test('округление: подытоги и «Всего КНС» — сумма уже округлённых строк', () => {
  const p = project([
    route('r1', [segment('s1', vertex('a', 0), vertex('b', 37.5))], {
      type: 'Лоток', trayWidthMm: 100, trayHeightMm: 50, subsystem: 'trunk',
    }),
    route('r2', [segment('s2', vertex('c', 0), vertex('d', 25))], {
      type: 'Лоток', trayWidthMm: 50, trayHeightMm: 50, subsystem: 'trunk',
    }),
  ], [
    price('p100', 'Лоток', '100×50', 10, 'L-100'),
    price('p50', 'Лоток', '50×50', 10, 'L-50'),
  ]);
  p.estimate = { laborPercent: 0, rounding: 10 };

  const spec = specificationKnS(p);
  assert.deepEqual(spec.lines.map(line => line.cost), [30, 40], '25 → 30 и 37,5 → 40');
  // 37,5 + 25 = 62,5 дало бы 60 при пересчёте из длины; сумма строк — 70.
  assert.equal(spec.subsystems[0].cost, 70);
  assert.equal(spec.totals[0].cost, 70);
  assert.equal(spec.totalCost, 70);

  const sheet = exportSheets(p).find(item => item.name === 'Спецификация КНС')!;
  const totalRow = sheet.rows.find(row => row[0] === 'Всего КНС')!;
  assert.deepEqual(totalRow, ['Всего КНС', '', '', 'м', 6.25, null, '', '', '', 70]);
});

test('лист «Спецификация КНС»: подытоги по подсистемам, итоги по типам и «Всего КНС»', () => {
  const sheet = exportSheets(subsystemsProject()).find(item => item.name === 'Спецификация КНС')!;
  assert.deepEqual(sheet.rows[0], ['Наименование', 'Сечение', 'Подсистема', 'Ед.', 'Кол-во', 'Углы', 'Артикул', 'Производитель', 'Цена, ₽', 'Сумма, ₽']);

  // Подытог: «Итого по подсистеме» в первой колонке, имя подсистемы — в колонке «Подсистема».
  const rowIndex = (name: string): number => sheet.rows.findIndex(row => row[0] === 'Итого по подсистеме' && row[2] === name);
  assert.deepEqual(sheet.rows[rowIndex('Магистральная')], ['Итого по подсистеме', '', 'Магистральная', 'м', 10, null, '', '', '', 4800]);
  assert.deepEqual(sheet.rows[rowIndex('Горизонтальная')], ['Итого по подсистеме', '', 'Горизонтальная', 'м', 20, 1, '', '', '', 4200]);
  assert.deepEqual(sheet.rows.find(row => row[0] === 'Всего КНС'), ['Всего КНС', '', '', 'м', 30, null, '', '', '', 9000]);

  // Подытог идёт после строк своей подсистемы, а не впереди.
  const horizontalSubtotal = rowIndex('Горизонтальная');
  const horizontalLines = sheet.rows
    .map((row, index) => ({ row, index }))
    .filter(item => item.row[2] === 'Горизонтальная' && item.row[1] !== '');
  assert.equal(horizontalLines.length, 2);
  assert.ok(horizontalLines.every(item => item.index < horizontalSubtotal));

  // «Итого по типам»: у типа строка с единицей «м», метражом, углами и стоимостью.
  const typeTotal = sheet.rows.find(row => row[0] === 'Лоток' && row[1] === '' && row[3] === 'м')!;
  assert.deepEqual(typeTotal, ['Лоток', '', '', 'м', 15, null, '', '', '', 6300]);
  const indexOf = (label: string): number => sheet.rows.findIndex(row => row[0] === label);
  assert.ok(indexOf('Итого по типам') < indexOf('Всего КНС'));
});
