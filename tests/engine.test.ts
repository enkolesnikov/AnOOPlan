import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCable, dimensionGeometry, dimensionText, findRoute, routeAngleStats, routeLength, routeSummary, segmentLength, specificationKnS, specifications, suggestRouteSection, validateProject } from '../src/engine';
import type { Project } from '../src/model';
import { baseProject, closeTo, device, route, segment, vertex } from './fixtures';

/** Проект тестов расчёта: трасса и оборудование лежат на одной высоте (3 м). */
function fixture(): Project {
  return baseProject({
    routes: [route('r', [segment('s', vertex('v1', 0), vertex('v2', 100))])],
  });
}
const close = (actual: number | null, expected: number) => closeTo(actual, expected, 1e-10);
const incomplete = (p: Project) => {
  const result = calculateCable(p, p.cables[0]);
  assert.equal(result.complete, false);
  assert.equal(result.total, null);
  assert.equal(result.geometry, null);
  assert.ok(result.errors.length > 0);
  assert.ok(validateProject(p).length > 0);
};

test('формула сохраняет точность, разделяет запасы и добавляет вертикальные подводы', () => {
  const p = fixture();
  p.routes[0].segments[0].reservePercent = 10;
  p.routes[0].segments[0].reserveFixed = 0.25;
  Object.assign(p.cables[0], { reservePercent: 20, reserveFixed: 0.3, startReserve: 1, endReserve: 2, quantity: 7 });
  const result = calculateCable(p, p.cables[0]);
  assert.equal(result.complete, true);
  assert.deepEqual(result.errors, []);
  close(result.geometry, 14);
  close(result.routeReserve, 1.25);
  close(result.cableReserve, 3.1);
  close(result.endReserve, 3);
  close(result.total, 21.35);
  assert.deepEqual(result.segments, [{ id: 's', length: 10 }]);
  close(specifications(p).cables[0].total, 21.35 * 7);
  close(specifications(p).cables[0].geometry, 14 * 7);
  close(specifications(p).infrastructure[0].length, 10);
});

test('ортогональный участок складывает горизонтальную и вертикальную длину, spatial использует гипотенузу', () => {
  const p = fixture();
  const s = segment('s', vertex('a', 0, 0, 0), vertex('b', 30, 0, 4));
  close(segmentLength(p, s), 7);
  close(segmentLength(p, { ...s, mode: 'spatial' }), 5);
  const diagonal = { ...s, b: vertex('b', 30, 40, 12) };
  assert.equal(segmentLength(p, diagonal), null);
  close(segmentLength(p, { ...diagonal, mode: 'spatial' }), 13);
});

test('межэтажная вертикаль учитывает отметки пола и высоты', () => {
  const p = fixture();
  const s = segment('s', vertex('a', 0, 0, 3), vertex('b', 0, 0, 1, 'f2'));
  p.routes[0].segments = [s];
  p.equipment[1] = device('b', 0, { height: 0, floorId: 'f2' });
  close(segmentLength(p, s), 2);
  close(calculateCable(p, p.cables[0]).geometry, 5);
  s.b.x = 1;
  assert.equal(segmentLength(p, s), null);
  incomplete(p);
});

test('цепочка обходится в обратном направлении независимо от хранения сегментов', () => {
  const p = fixture();
  p.routes[0].segments = [
    segment('s1', vertex('b', 50), vertex('a', 0)),
    segment('s2', vertex('c', 100), vertex('b2', 50)),
  ];
  p.cables[0].segmentIds = ['s1', 's2'];
  close(calculateCable(p, p.cables[0]).total, 14);
  Object.assign(p.cables[0], { fromId: 'b', toId: 'a', segmentIds: ['s2', 's1'] });
  close(calculateCable(p, p.cables[0]).total, 14);
});

test('связность допускает погрешность 1e-6, но требует совпадения высот и этажей', () => {
  const p = fixture();
  p.routes[0].segments = [segment('s1', vertex('a', 0), vertex('b', 50)), segment('s2', vertex('c', 50 + 0.0000005), vertex('d', 100))];
  p.cables[0].segmentIds = ['s1', 's2'];
  assert.equal(calculateCable(p, p.cables[0]).complete, true);
  p.routes[0].segments[1].a.height = 3.01;
  incomplete(p);
  p.routes[0].segments[1].a.height = 3;
  p.routes[0].segments[1].a.floorId = 'f2';
  incomplete(p);
});

for (const [name, mutate] of [
  ['неизвестная высота оборудования', (p: Project) => { p.equipment[0].height = null; }],
  ['неизвестная высота трассы', (p: Project) => { p.routes[0].segments[0].a.height = null; }],
  ['неизвестный масштаб', (p: Project) => { p.floors[0].metersPerUnit = null; }],
  ['нулевой масштаб', (p: Project) => { p.floors[0].metersPerUnit = 0; }],
  ['неизвестная отметка', (p: Project) => { p.floors[0].elevation = null; }],
  ['отсутствующий этаж', (p: Project) => { p.routes[0].segments[0].a.floorId = 'missing'; }],
  ['отсутствующее оборудование', (p: Project) => { p.cables[0].fromId = 'missing'; }],
  ['неверное положение конца', (p: Project) => { p.equipment[1].x = 99; }],
  ['повтор сегмента', (p: Project) => { p.cables[0].segmentIds.push('s'); }],
  ['отсутствующий сегмент', (p: Project) => { p.cables[0].segmentIds.push('missing'); }],
  ['пустой маршрут', (p: Project) => { p.cables[0].segmentIds = []; }],
  ['разрыв цепочки', (p: Project) => { p.routes[0].segments.push(segment('s2', vertex('c', 200), vertex('d', 300))); p.cables[0].segmentIds.push('s2'); }],
  ['повтор ID сегмента в трассах', (p: Project) => { p.routes.push({ ...p.routes[0], id: 'r2' }); }],
  ['отрицательный запас', (p: Project) => { p.cables[0].reserveFixed = -1; }],
  ['нечисловой запас участка', (p: Project) => { p.routes[0].segments[0].reservePercent = Number.NaN; }],
  ['дробное количество', (p: Project) => { p.cables[0].quantity = 1.5; }],
] as const) {
  test(`${name}: расчёт неполный без фиктивного итога`, () => { const p = fixture(); mutate(p); incomplete(p); });
}

test('нулевые высоты и отметки являются известными значениями', () => {
  const p = fixture();
  p.equipment.forEach(e => { e.height = 0; });
  p.routes[0].segments.forEach(s => { s.a.height = 0; s.b.height = 0; });
  close(calculateCable(p, p.cables[0]).total, 10);
  assert.deepEqual(validateProject(p), []);
});

test('спецификация объединяет модели и марки, инфраструктуру считает один раз', () => {
  const p = fixture();
  p.cables[0].quantity = 3;
  p.cables.push({ ...p.cables[0], id: 'c2', number: 'К2', quantity: 2 });
  const spec = specifications(p);
  assert.deepEqual(spec.equipment, [{ type: 'Датчик', model: 'Д-1', floor: 'Первый', quantity: 2 }]);
  assert.deepEqual(spec.cables, [{ brand: 'ВВГ', lines: 5, geometry: 70, total: 70 }]);
  assert.deepEqual(spec.infrastructure, [{ type: 'Лоток', length: 10, segments: 1, cables: 5, maxFillPercent: null, overSegments: 0 }]);
  assert.deepEqual(spec.errors, []);
});

test('неполная кабельная группа не выдаёт частичную длину как полный итог', () => {
  const p = fixture();
  p.cables.push({ ...p.cables[0], id: 'c2', segmentIds: ['missing'] });
  p.cables.push({ ...p.cables[0], id: 'c3', brand: 'Другой' });
  const spec = specifications(p);
  assert.deepEqual(spec.cables[0], { brand: 'ВВГ', lines: 2, geometry: null, total: null });
  close(spec.cables[1].total, 14);
  assert.ok(spec.errors.length);
});

test('неполная инфраструктура даёт null; повторы ID не удваивают длину', () => {
  const p = fixture();
  p.routes[0].segments.push(segment('s2', vertex('c', 100), vertex('d', 200, 0, null)));
  assert.equal(specifications(p).infrastructure[0].length, null);
  p.routes[0].segments.pop();
  p.routes.push({ ...p.routes[0], id: 'r2' });
  const spec = specifications(p);
  assert.equal(spec.infrastructure[0].length, null);
  assert.equal(spec.infrastructure[0].segments, 1);
});

test('геометрия зависит только от координат страницы и масштаба, без округления', () => {
  const p = fixture();
  p.floors[0].metersPerUnit = 1 / 3;
  p.routes[0].segments[0].b.x = 1;
  p.equipment[1].x = 1;
  close(segmentLength(p, p.routes[0].segments[0]), 1 / 3);
  const before = calculateCable(p, p.cables[0]);
  p.floors[0].width *= 2;
  p.floors[0].height *= 2;
  assert.deepEqual(calculateCable(p, p.cables[0]), before);
});

test('validateProject проверяет неиспользуемую инфраструктуру и дубли сущностей', () => {
  const p = fixture();
  p.equipment.push({ ...p.equipment[0] });
  p.routes[0].segments.push(segment('unused', vertex('a', 0, 0, null), vertex('b', 10)));
  const errors = validateProject(p);
  assert.ok(errors.some(e => e.includes('ID оборудования')));
  assert.ok(errors.some(e => e.includes('unused')));
});

test('findRoute прокладывает маршрут по сегментам между устройствами', () => {
  const p = fixture();
  assert.deepEqual(findRoute(p, 'a', 'b').segmentIds, ['s']);
  assert.equal(findRoute(p, 'a', 'b').error, undefined);

  p.routes[0].segments = [
    segment('s1', vertex('a', 0), vertex('m', 50)),
    segment('s2', vertex('m', 50), vertex('b', 100)),
    segment('s3', vertex('m', 50), vertex('c', 200)),
  ];
  assert.deepEqual(findRoute(p, 'a', 'b').segmentIds, ['s1', 's2']);

  p.routes[0].segments = [
    segment('s1', vertex('a', 0), vertex('m', 50)),
    segment('s2', vertex('c', 200), vertex('d', 300)),
  ];
  p.equipment[1] = device('b', 300);
  assert.ok(findRoute(p, 'a', 'b').error);
  assert.equal(findRoute(p, 'a', 'b').segmentIds.length, 0);
});

test('validateProject требует уникальные имена и номера оборудования', () => {
  const p = fixture();
  p.equipment[1].name = p.equipment[0].name;
  assert.ok(validateProject(p).some(e => e.includes('Повторное имя')));
  p.equipment[1].name = 'Другой датчик';
  p.equipment[1].number = p.equipment[0].number;
  assert.ok(validateProject(p).some(e => e.includes('Повторный номер')));
});

test('findRoute выбирает маршрут по длине, а не по числу сегментов', () => {
  const p = fixture();
  const a = vertex('a', 0, 0, 3);
  const mid = vertex('mid', 0, 100, 3);
  const c1 = vertex('c1', 33, 0, 3);
  const c2 = vertex('c2', 66, 0, 3);
  const b = vertex('b', 100, 0, 3);
  // Длинный путь из двух сегментов (24.1 м) против короткого из трёх (10 м).
  p.routes[0].segments = [
    segment('s1', a, mid),
    segment('s2', mid, b, { mode: 'spatial' }),
    segment('s3', a, c1),
    segment('s4', c1, c2),
    segment('s5', c2, b),
  ];
  assert.deepEqual(findRoute(p, 'a', 'b').segmentIds, ['s3', 's4', 's5']);
});


test('длина трассы, углы и сводка по типам КНС', () => {
  const p = fixture();
  const v2 = vertex('v2', 100, 0);
  const v3 = vertex('v3', 100, 50);
  p.routes = [
    { id: 'r1', number: 'Г1', type: 'Гофра', note: '', segments: [segment('s1', vertex('a1', 0), v2)] },
    { id: 'r2', number: 'К1', type: 'Кабель-канал', note: '', segments: [segment('s2', vertex('a2', 0), v2), segment('s3', v2, v3)] },
  ];
  assert.equal(routeLength(p, p.routes[0]), 10);
  assert.equal(routeAngleStats(p.routes[0]).total, 0);
  const angles = routeAngleStats(p.routes[1]);
  assert.deepEqual(angles, { total: 1, angles90: 1, angles45: 0, other: 0 });
  assert.equal(routeLength(p, p.routes[1]), 15);
  const summary = routeSummary(p);
  assert.deepEqual(summary.groups.map(group => [group.group, group.length]), [['Гофра', 10], ['Кабель-канал', 15]]);
  assert.equal(summary.groups[1].angles.total, 1);
});

test('относительный размер между оборудованием считается по прямой', () => {
  const p = fixture();
  p.equipment.push(device('c', 0, { height: 1, floorId: 'f2' }));
  const flat = dimensionGeometry(p, { id: 'd1', fromId: 'a', toId: 'b' });
  assert.deepEqual(flat.units, 100);
  assert.deepEqual(flat.meters, 10);
  assert.equal(dimensionText(flat), '10,00 м');
  const small = dimensionGeometry(p, { id: 'd2', fromId: 'a', toId: 'b' });
  assert.equal(dimensionText({ ...small, meters: 0.5 }), '500 мм');
  const across = dimensionGeometry(p, { id: 'd3', fromId: 'a', toId: 'c' });
  assert.equal(across.problem, 'Оборудование на разных этажах');
  assert.equal(across.meters, null);
});


test('спецификация КНС: подсистемы, углы и артикулы из справочника', () => {
  const p = fixture();
  const v2 = vertex('v2', 100, 0);
  const v3 = vertex('v3', 100, 50);
  p.routes = [
    { id: 'r1', number: 'Г1', type: 'Гофра', note: '', subsystem: 'trunk', segments: [segment('s1', vertex('a1', 0), v2)] },
    { id: 'r2', number: 'К1', type: 'Кабель-канал', note: '', subsystem: 'horizontal', segments: [segment('s2', vertex('a2', 0), v2), segment('s3', v2, v3)] },
  ];
  p.catalog = [
    { id: 'c1', kind: 'tray', name: 'Гофра', unit: 'м', price: 42, note: '', article: 'GF-20', manufacturer: 'IEK' },
    { id: 'c2', kind: 'tray', name: 'Кабель-канал', unit: 'м', price: 180, note: '', article: 'KK-25', manufacturer: 'DKC' },
  ];
  const spec = specificationKnS(p);
  assert.deepEqual(spec.lines.map(line => [line.name, line.subsystem, line.quantity, line.angles]), [
    ['Гофра', 'Магистральная', 10, 0],
    ['Кабель-канал', 'Горизонтальная', 15, 1],
  ]);
  assert.equal(spec.lines[0].article, 'GF-20');
  assert.equal(spec.lines[1].manufacturer, 'DKC');
  assert.equal(spec.lines[0].cost, 420);
  assert.equal(spec.totalCost, 420 + 2700);
});

test('подбор минимального сечения КНС по кабелям', () => {
  const p = fixture();
  p.routes[0].type = 'Гофра';
  p.routes[0].trayWidthMm = null;
  p.routes[0].trayHeightMm = null;
  p.routes[0].trayAreaMm2 = null;
  p.cables = [{ id: 'c', number: 'К1', name: 'Кабель', brand: 'ВВГ', purpose: '', fromId: 'a', toId: 'b', segmentIds: ['s'], reservePercent: 0, reserveFixed: 0, startReserve: 0, endReserve: 0, quantity: 1, note: '', outerDiameterMm: 10 }];
  const suggestion = suggestRouteSection(p, p.routes[0]);
  assert.ok(suggestion, 'подбор должен вернуть сечение');
  assert.equal(suggestion!.kind, 'diameter');
  assert.ok(suggestion!.widthMm >= 16);
  assert.ok(suggestion!.fillPercent <= 40);
});
