import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogPrice,
  estimate,
  normalizeCatalog,
  normalizePriceItem,
} from '../src/estimate';
import { createDemoProject } from '../src/demo';
import { migrateProject } from '../src/migrations';
import { ApiError, assertProject } from '../server/validation.js';
import type { Cable, Equipment, Project, Segment, Vertex } from '../src/model';

const vertex = (id: string, x: number, y = 0, height = 1, floorId = 'f1'): Vertex => ({ id, x, y, height, floorId });
const segment = (id: string, a: Vertex, b: Vertex): Segment => ({ id, a, b, mode: 'orthogonal', reservePercent: 0, reserveFixed: 0 });
const device = (id: string, x: number, model = 'Д-1'): Equipment => ({
  id, number: id.toUpperCase(), name: `Устройство ${id}`, type: 'Датчик', floorId: 'f1', x, y: 0, height: 1, note: '', properties: { model },
});
const cable = (extra: Partial<Cable> = {}): Cable => ({
  id: 'c1', number: 'К1', name: 'Линия', brand: 'ВВГ', purpose: '',
  fromId: 'a', toId: 'b', segmentIds: ['s1'], reservePercent: 0, reserveFixed: 0,
  startReserve: 0, endReserve: 0, quantity: 1, note: '', pricePerMeter: 50, ...extra,
});

/**
 * Малый проект с точной арифметикой: два одинаковых устройства (10 000 ₽),
 * кабель 10 м × 50 ₽ (ручная цена), лоток 10 м × 480 ₽, работы 25 %.
 */
function project(): Project {
  return {
    schemaVersion: 2, id: 'p', name: 'Смета', updatedAt: '2026-01-01T00:00:00Z',
    floors: [{ id: 'f1', name: 'Первый', elevation: 0, metersPerUnit: 0.1, page: 1, width: 1000, height: 700 }],
    equipment: [device('a', 0), device('b', 100)],
    routes: [{
      id: 'r', number: 'Т1', type: 'Лоток', note: '',
      segments: [segment('s1', vertex('v1', 0), vertex('v2', 100))],
    }],
    cables: [cable()],
    pins: [],
    catalog: [
      { id: 'e1', kind: 'equipment', name: 'Д-1', unit: 'шт', price: 5000, note: '' },
      { id: 'cb1', kind: 'cable', name: 'ВВГ', unit: 'м', price: 40, note: '' },
      { id: 't1', kind: 'tray', name: 'Лоток', unit: 'м', price: 480, note: '' },
    ],
    catalogDate: '2026-10-01',
    estimate: { laborPercent: 25 },
  };
}

const close = (actual: number | null, expected: number) => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) < 1e-9, `${actual} != ${expected}`);
};

test('смета считает оборудование, кабели, лотки и работы точными числами', () => {
  const result = estimate(project());
  assert.deepEqual(result.sections.map(section => [section.kind, section.title]), [
    ['equipment', 'Оборудование'],
    ['cable', 'Кабели'],
    ['tray', 'Лотки'],
    ['work', 'Работы'],
  ]);
  const [equipment, cables, trays, works] = result.sections;

  assert.deepEqual(equipment.lines, [{
    id: 'equipment:Д-1', kind: 'equipment', name: 'Д-1', unit: 'шт',
    quantity: 2, price: 5000, total: 10000, priceSource: 'catalog', note: '',
  }]);
  assert.equal(equipment.total, 10000);
  assert.equal(equipment.complete, true);
  assert.deepEqual(equipment.warnings, []);

  assert.deepEqual(cables.lines, [{
    id: 'cable:c1', kind: 'cable', name: 'К1 · ВВГ', unit: 'м',
    quantity: 10, price: 50, total: 500, priceSource: 'manual', note: '',
  }]);
  assert.equal(cables.total, 500);
  assert.equal(cables.complete, true);

  assert.deepEqual(trays.lines, [{
    id: 'tray:Лоток', kind: 'tray', name: 'Лоток', unit: 'м',
    quantity: 10, price: 480, total: 4800, priceSource: 'catalog', note: '',
  }]);
  assert.equal(trays.total, 4800);
  assert.equal(trays.complete, true);

  assert.deepEqual(works.lines, []);
  assert.equal(works.total, 3825);
  assert.equal(works.complete, true);

  assert.equal(result.materials, 15300);
  assert.equal(result.laborPercent, 25);
  assert.equal(result.labor, 3825);
  assert.equal(result.total, 19125);
  assert.equal(result.complete, true);
  assert.equal(result.catalogDate, '2026-10-01');
  assert.deepEqual(result.warnings, []);
});

test('ручная цена кабеля приоритетнее справочника, неверная — не подменяется нулём', () => {
  const p = project();
  assert.equal(estimate(p).sections[1].lines[0].price, 50);
  assert.equal(estimate(p).sections[1].lines[0].priceSource, 'manual');

  delete p.cables[0].pricePerMeter;
  const fromCatalog = estimate(p).sections[1].lines[0];
  assert.equal(fromCatalog.price, 40);
  assert.equal(fromCatalog.priceSource, 'catalog');
  assert.equal(fromCatalog.total, 400);

  p.cables[0].pricePerMeter = -5; // некорректная ручная цена не превращается в 0 и не применяется
  const fallback = estimate(p).sections[1].lines[0];
  assert.equal(fallback.price, 40);
  assert.equal(fallback.priceSource, 'catalog');
  assert.equal(fallback.total, 400);

  p.catalog = p.catalog!.filter(item => item.kind !== 'cable');
  const noPrice = estimate(p).sections[1].lines[0];
  assert.equal(noPrice.price, null);
  assert.equal(noPrice.priceSource, null);
  assert.equal(noPrice.total, null);
});

test('оборудование группируется по модели: properties.model приоритетнее name', () => {
  const p = project();
  p.equipment = [device('a', 0), device('b', 100), { ...device('c', 200), properties: { model: '' } }];
  p.catalog!.push({ id: 'e2', kind: 'equipment', name: 'Устройство c', unit: 'шт', price: 100, note: '' });
  const lines = estimate(p).sections[0].lines;
  assert.deepEqual(lines.map(line => [line.name, line.quantity, line.total]), [
    ['Д-1', 2, 10000],
    ['Устройство c', 1, 100],
  ]);
});

test('отсутствие цены: null, неполный раздел и предупреждение, а не 0', () => {
  const p = project();
  p.catalog = p.catalog!.filter(item => item.kind !== 'equipment');
  const result = estimate(p);
  const [equipment] = result.sections;
  assert.equal(equipment.lines[0].price, null);
  assert.equal(equipment.lines[0].total, null);
  assert.equal(equipment.lines[0].priceSource, null);
  assert.equal(equipment.total, null);
  assert.equal(equipment.complete, false);
  assert.deepEqual(equipment.warnings, ['Смета: для «Д-1» нет цены в справочнике']);
  assert.equal(result.materials, null);
  assert.equal(result.labor, null);
  assert.equal(result.total, null);
  assert.equal(result.complete, false);
  assert.ok(result.warnings.some(warning => warning.includes('нет цены в справочнике')));

  // Позиция в справочнике есть, но цена неизвестна — это тоже «нет цены», а не 0.
  const nullPrice = project();
  nullPrice.catalog = [{ id: 'e1', kind: 'equipment', name: 'Д-1', unit: 'шт', price: null, note: '' }];
  const nullLine = estimate(nullPrice).sections[0].lines[0];
  assert.equal(nullLine.price, null);
  assert.equal(nullLine.total, null);
  assert.ok(estimate(nullPrice).warnings.includes('Смета: для «Д-1» нет цены в справочнике'));
});

test('без процента работ работы и итог неполные, есть предупреждение', () => {
  const p = project();
  delete p.estimate;
  const result = estimate(p);
  assert.equal(result.materials, 15300, 'материалы известны');
  assert.equal(result.laborPercent, null);
  assert.equal(result.labor, null);
  assert.equal(result.total, null);
  assert.equal(result.sections[3].total, null);
  assert.equal(result.sections[3].complete, false);
  assert.equal(result.complete, false);
  assert.ok(result.warnings.includes('Смета: не задан процент работ'));
});

test('неверный процент работ (−5, NaN) не применяется и помечается предупреждением', () => {
  for (const laborPercent of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const p = project();
    p.estimate = { laborPercent };
    const result = estimate(p);
    assert.equal(result.laborPercent, null);
    assert.equal(result.labor, null);
    assert.equal(result.total, null);
    assert.equal(result.complete, false);
    assert.ok(result.warnings.includes('Смета: неверный процент работ'), `процент ${laborPercent}`);
  }
});

test('ноль процентов работ — заданное значение: работы 0, смета полная', () => {
  const p = project();
  p.estimate = { laborPercent: 0 };
  const result = estimate(p);
  assert.equal(result.laborPercent, 0);
  assert.equal(result.labor, 0);
  assert.equal(result.total, 15300);
  assert.equal(result.sections[3].complete, true);
  assert.equal(result.complete, true);
  assert.deepEqual(result.warnings, []);
});

test('пустой и отсутствующий каталог: все материальные строки без цен', () => {
  for (const catalog of [[], undefined]) {
    const p = project();
    p.catalog = catalog;
    delete p.cables[0].pricePerMeter;
    const result = estimate(p);
    assert.equal(result.materials, null);
    assert.equal(result.total, null);
    assert.equal(result.complete, false);
    for (const section of result.sections.slice(0, 3)) {
      assert.equal(section.total, null);
      assert.equal(section.complete, false);
      for (const line of section.lines) {
        assert.equal(line.price, null);
        assert.equal(line.total, null);
      }
    }
    assert.equal(result.warnings.length, 3);
  }
});

test('неверное количество кабеля: строка неполная и предупреждение, а не 0', () => {
  const p = project();
  p.cables[0].quantity = 0;
  const result = estimate(p);
  const line = result.sections[1].lines[0];
  assert.equal(line.quantity, null);
  assert.equal(line.total, null);
  assert.ok(line.note.includes('количество'), line.note);
  assert.equal(result.sections[1].complete, false);
  assert.ok(result.warnings.includes('Смета: по кабелю К1 неполный расчёт — количество неизвестно'));
});

test('неизвестная длина трассы: лоток неполный и предупреждение', () => {
  const p = project();
  p.floors[0].metersPerUnit = null;
  const result = estimate(p);
  const line = result.sections[2].lines[0];
  assert.equal(line.quantity, null);
  assert.equal(line.total, null);
  assert.equal(result.sections[2].complete, false);
  assert.ok(result.warnings.includes('Смета: по трассе «Лоток» неполный расчёт — длина неизвестна'));
});

test('normalizePriceItem: валидная запись нормализуется', () => {
  assert.deepEqual(
    normalizePriceItem({ id: 'p9', kind: 'cable', name: '  ВВГ  ', unit: ' м ', price: 12.5, note: 'прайс' }),
    { id: 'p9', kind: 'cable', name: 'ВВГ', unit: 'м', price: 12.5, note: 'прайс' },
  );
  assert.deepEqual(
    normalizePriceItem({ kind: 'equipment', name: 'Шкаф' }),
    { id: 'price-1', kind: 'equipment', name: 'Шкаф', unit: 'шт', price: null, note: '' },
  );
  assert.equal(normalizePriceItem({ kind: 'tray', name: 'Лоток', price: 0 })?.price, 0, '0 — известная цена');
  assert.equal(normalizePriceItem({ kind: 'tray', name: 'Лоток' }, 3)?.id, 'price-4');
  assert.equal(normalizePriceItem({ id: '  ', kind: 'tray', name: 'Лоток' })?.id, 'price-1');
});

test('normalizePriceItem: мусор отбрасывается, цена не подменяется нулём', () => {
  for (const value of [null, undefined, 42, 'строка', [], true]) {
    assert.equal(normalizePriceItem(value), null, `значение ${JSON.stringify(value)}`);
  }
  for (const value of [
    { kind: 'unknown', name: 'X' },
    { kind: 'cable' },
    { kind: 'cable', name: '   ' },
    { kind: 'cable', name: 5 },
  ]) {
    assert.equal(normalizePriceItem(value), null, `запись ${JSON.stringify(value)}`);
  }
  for (const price of [-1, -0.01, Number.NaN, Number.POSITIVE_INFINITY, '100', true, {}, []]) {
    assert.equal(normalizePriceItem({ kind: 'cable', name: 'ВВГ', price })?.price, null, `цена ${String(price)}`);
  }
});

test('normalizeCatalog: не-массив — пустой каталог, мусорные записи отбрасываются', () => {
  for (const value of [undefined, null, 'каталог', 5, {}]) {
    assert.deepEqual(normalizeCatalog(value), []);
  }
  assert.deepEqual(normalizeCatalog([]), []);
  const catalog = normalizeCatalog([
    { kind: 'equipment', name: 'Шкаф', price: 100 },
    null,
    { kind: 'bad', name: 'X', price: 1 },
    { kind: 'cable', name: '', price: 1 },
    { id: 't2', kind: 'tray', name: 'Лоток', unit: 'м', price: -5 },
  ]);
  assert.equal(catalog.length, 2);
  assert.deepEqual(catalog[0], { id: 'price-1', kind: 'equipment', name: 'Шкаф', unit: 'шт', price: 100, note: '' });
  assert.deepEqual(catalog[1], { id: 't2', kind: 'tray', name: 'Лоток', unit: 'м', price: null, note: '' });
  const zeroPriced = normalizeCatalog([{ kind: 'equipment', name: 'Бесплатно', price: 0 }]);
  assert.equal(zeroPriced[0]?.price, 0, 'цена 0 — известное значение, а не отсутствие');
});

test('normalizeCatalog разводит дубли id, включая fallback price-N', () => {
  const catalog = normalizeCatalog([
    { id: 'price-2', kind: 'equipment', name: 'A', price: 1 },
    { kind: 'equipment', name: 'B', price: 2 },
    { id: 'price-2', kind: 'cable', name: 'C', price: 3 },
  ]);
  assert.equal(catalog.length, 3);
  const ids = catalog.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length, `дубли id: ${ids.join(', ')}`);
});

test('цена 0 — известное значение: смета полная, а не «нет цены»', () => {
  const p = project();
  p.cables = [];
  p.catalog = [
    { id: 'e1', kind: 'equipment', name: 'Д-1', unit: 'шт', price: 0, note: '' },
    { id: 't1', kind: 'tray', name: 'Лоток', unit: 'м', price: 0, note: '' },
  ];
  const result = estimate(p);
  assert.equal(result.materials, 0);
  assert.equal(result.labor, 0);
  assert.equal(result.total, 0);
  assert.equal(result.complete, true);
  assert.equal(result.sections[0].lines[0].price, 0);
  assert.equal(result.sections[0].lines[0].priceSource, 'catalog');
});

test('переполнение (Infinity) не даёт «полную» смету', () => {
  const p = project();
  p.catalog = [{ id: 'e1', kind: 'equipment', name: 'Д-1', unit: 'шт', price: Number.MAX_VALUE, note: '' }];
  const result = estimate(p);
  assert.equal(result.materials, null, 'материалы не должны стать Infinity');
  assert.equal(result.labor, null);
  assert.equal(result.total, null);
  assert.equal(result.complete, false);
  assert.ok(result.warnings.some(warning => warning.includes('не является конечным числом')), result.warnings.join('; '));
  const [equipment, , , works] = result.sections;
  assert.equal(equipment.total, null);
  assert.equal(equipment.complete, false);
  assert.equal(works.complete, false, 'работы не рассчитаны, если материалы неизвестны');
});

test('catalogPrice: поиск без учёта регистра и пробелов, первое совпадение', () => {
  const catalog = normalizeCatalog([
    { kind: 'cable', name: ' ВВГ ', price: 40 },
    { kind: 'cable', name: 'ВВГ', price: 99 },
    { kind: 'tray', name: 'ВВГ', price: 1 },
  ]);
  assert.equal(catalogPrice(catalog, 'cable', 'ввг')?.price, 40, 'первое совпадение');
  assert.equal(catalogPrice(catalog, 'cable', '  ВВГ  ')?.price, 40);
  assert.equal(catalogPrice(catalog, 'tray', 'ВВГ')?.price, 1);
  assert.equal(catalogPrice(catalog, 'equipment', 'ВВГ'), null, 'вид позиции учитывается');
  assert.equal(catalogPrice(undefined, 'cable', 'ВВГ'), null);
  assert.equal(catalogPrice([], 'cable', 'ВВГ'), null);
  assert.equal(catalogPrice(catalog, 'cable', 'НЕТ'), null);
});

test('catalogDate: только валидная дата YYYY-MM-DD, иначе null', () => {
  for (const value of ['2026-10-01', '2024-02-29']) {
    const p = project();
    p.catalogDate = value;
    assert.equal(estimate(p).catalogDate, value);
  }
  for (const value of ['01.10.2026', '2026-13-01', '2026-02-30', '', '2026-1-01', null, undefined, 20261001]) {
    const p = project();
    p.catalogDate = value as unknown as string;
    assert.equal(estimate(p).catalogDate, null, `дата ${String(value)}`);
  }
});

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
};

test('estimate не мутирует проект', () => {
  const p = project();
  const before = JSON.stringify(p);
  estimate(p);
  assert.equal(JSON.stringify(p), before);
  // Замороженный проект: любая запись бросила бы TypeError в строгом режиме модуля.
  assert.doesNotThrow(() => estimate(deepFreeze(project())));
});

test('демо-проект: смета полная, итог положительный, цены из справочника и ручные', () => {
  const demo = createDemoProject();
  const result = estimate(demo);
  assert.equal(result.complete, true);
  assert.equal(result.catalogDate, '2026-10-01');
  assert.equal(result.laborPercent, 25);
  assert.ok(result.materials !== null && result.materials > 0);
  assert.ok(result.labor !== null && result.labor > 0);
  assert.ok(result.total !== null && result.total > 0);
  close(result.labor, result.materials! * 25 / 100);
  close(result.total, result.materials! + result.labor!);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.sections.every(section => section.complete));

  const [equipment, cables, trays] = result.sections;
  assert.equal(equipment.lines.length, 7);
  assert.ok(equipment.lines.every(line => line.priceSource === 'catalog' && line.price !== null));
  assert.equal(cables.lines.length, 4);
  assert.ok(cables.lines.every(line => line.priceSource === 'manual' && line.price === 38));
  assert.deepEqual(trays.lines.map(line => [line.name, line.quantity, line.price]), [
    ['Лоток', 55, 480],
    ['Стояк', 4, 620],
  ]);
  assert.deepEqual(cables.lines.map(line => line.quantity), [15.3, 26.3, 91.1, 27.95]);
});

test('снимок: смена прайса в живом проекте не пересчитывает старую копию', () => {
  const live = project();
  live.catalog = [
    { id: 'e1', kind: 'equipment', name: 'Д-1', unit: 'шт', price: 100, note: '' },
    { id: 'cb1', kind: 'cable', name: 'ВВГ', unit: 'м', price: 10, note: '' },
    { id: 't1', kind: 'tray', name: 'Лоток', unit: 'м', price: 20, note: '' },
  ];
  delete live.cables[0].pricePerMeter;
  const snapshot = migrateProject(JSON.parse(JSON.stringify(live)));
  const snapshotBefore = estimate(snapshot);
  assert.equal(snapshotBefore.materials, 500); // 2×100 + 10×10 + 10×20
  assert.equal(snapshotBefore.complete, true);

  live.catalog = live.catalog!.map(item => ({ ...item, price: item.price === null ? null : item.price * 2 }));
  assert.equal(estimate(live).materials, 1000, 'живой проект видит новый прайс');
  assert.equal(estimate(snapshot).materials, 500, 'снимок сохранил свои цены');
  assert.equal(snapshot.catalog?.[0].price, 100);
});

const rejectsProject = (input: unknown, pattern: RegExp) => {
  assert.throws(
    () => assertProject(input, () => true),
    (error: unknown) => error instanceof ApiError && error.status === 422 && pattern.test(error.message),
  );
};

test('assertProject принимает валидный каталог, дату прайса и смету', () => {
  assert.doesNotThrow(() => assertProject(project(), () => true));
  const nulls = project();
  nulls.catalog = [];
  nulls.catalogDate = null;
  nulls.estimate = { laborPercent: null, note: '' };
  assert.doesNotThrow(() => assertProject(nulls, () => true));
  const withoutNewFields = project();
  delete withoutNewFields.catalog;
  delete withoutNewFields.catalogDate;
  delete withoutNewFields.estimate;
  assert.doesNotThrow(() => assertProject(withoutNewFields, () => true));
});

test('assertProject отклоняет некорректный каталог с 422', () => {
  rejectsProject({ ...project(), catalog: 'каталог' } as unknown, /project\.catalog/);
  const cases: unknown[] = [
    [null],
    [{ kind: 'unknown', name: 'X', unit: 'шт', price: 1, note: '' }],
    [{ kind: 'equipment', name: '', unit: 'шт', price: 1, note: '' }],
    [{ kind: 'equipment', name: '   ', unit: 'шт', price: 1, note: '' }],
    [{ kind: 'equipment', name: 'X', unit: 'шт', price: -1, note: '' }],
    [{ kind: 'equipment', name: 'X', unit: 'шт', price: '100', note: '' }],
    [{ kind: 'equipment', name: 'X', unit: 5, price: 1, note: '' }],
    [{ kind: 'equipment', name: 'X', unit: 'шт', price: 1, note: 5 }],
    [{ kind: 'equipment', name: 'X', unit: 'шт', note: '' }],
  ];
  for (const catalog of cases) {
    const candidate = { ...project(), catalog } as unknown;
    rejectsProject(candidate, /project\.catalog: некорректная позиция/);
  }
});

test('assertProject отклоняет некорректные дату прайса и смету с 422', () => {
  for (const catalogDate of ['01.10.2026', '2026-13-01', '2026-02-30', '2026-1-01', 20261001, true]) {
    const candidate = { ...project(), catalogDate } as unknown;
    rejectsProject(candidate, /project\.catalogDate/);
  }
  for (const estimate of ['смета', [], { laborPercent: '25' }, { laborPercent: -5 }, { laborPercent: undefined }, { laborPercent: Number.NaN }]) {
    const candidate = { ...project(), estimate } as unknown;
    rejectsProject(candidate, /project\.estimate: некорректный процент работ/);
  }
  const badNote = { ...project(), estimate: { laborPercent: 25, note: 5 } } as unknown;
  rejectsProject(badNote, /project\.estimate: некорректное примечание/);
});
