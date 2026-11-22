import test from 'node:test';
import assert from 'node:assert/strict';
import { estimate, normalizeWorks, normalizeRounding, roundMoney } from '../src/estimate';
import { migrateProject } from '../src/migrations';
import { assertProject } from '../server/validation.js';
import type { Equipment, Project, WorkLine } from '../src/model';
import { baseProject, cable, device, floor, priceItem, rejectsProject, route, segment, vertex } from './fixtures';

/**
 * Смета 2.10.0: работы по видам, НДС и округление.
 *
 * Эталонные числа посчитаны вручную и зашиты в тесты: «сырые» значения 2.9.1
 * (материалы 15 300, работы 25 % = 3 825, итог 19 125, НДС 20 % = 3 825)
 * не должны поменяться без осознанного решения.
 */

/** Оборудование сметы: номер заглавными и имя «Устройство …» — так его называет смета. */
const estimateDevice = (id: string, x: number): Equipment =>
  device(id, x, { number: id.toUpperCase(), name: `Устройство ${id}`, properties: { model: 'Д-1' } });

/**
 * Малый проект с точной арифметикой 2.9.1: два устройства (10 000 ₽),
 * кабель 10 м × 50 ₽ (ручная цена), лоток 10 м × 480 ₽, работы 25 %.
 */
function base(): Project {
  return baseProject({
    name: 'Смета',
    floors: [floor('f1', { name: 'Первый' })],
    equipment: [estimateDevice('a', 0), estimateDevice('b', 100)],
    routes: [route('r', [segment('s1', vertex('v1', 0, 0, 1), vertex('v2', 100, 0, 1))])],
    cables: [cable({ id: 'c1', segmentIds: ['s1'], pricePerMeter: 50 })],
    catalog: [
      priceItem('e1', { name: 'Д-1', price: 5000 }),
      priceItem('cb1', { kind: 'cable', name: 'ВВГ', unit: 'м', price: 40 }),
      priceItem('t1', { kind: 'tray', name: 'Лоток', unit: 'м', price: 480 }),
    ],
    estimate: { laborPercent: 25 },
  });
}

/** Тот же проект с дробными ценами: оборудование ×2, кабель 10 м, лоток 10 м. */
function priced(equipment: number, cablePrice: number, tray: number): Project {
  const project = base();
  project.catalog = [
    priceItem('e1', { name: 'Д-1', price: equipment }),
    priceItem('cb1', { kind: 'cable', name: 'ВВГ', unit: 'м', price: 40 }),
    priceItem('t1', { kind: 'tray', name: 'Лоток', unit: 'м', price: tray }),
  ];
  project.cables[0].pricePerMeter = cablePrice;
  return project;
}

/** Каждое ненулевое денежное значение кратно шагу (с допуском на представление float). */
function assertMultiples(values: (number | null)[], rounding: number): void {
  for (const value of values) {
    if (value === null) continue;
    const steps = value / rounding;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, `${value} не кратно ${rounding}`);
  }
}

test('эталон вручную: материалы, работы, итог и НДС 20 % сверху', () => {
  const project = base();
  project.estimate = { laborPercent: 25, vatRate: 20, vatIncluded: false };
  const result = estimate(project);

  assert.equal(result.materials, 15300); // 2×5000 + 10×50 + 10×480
  assert.equal(result.laborPercent, 25);
  assert.equal(result.labor, 3825); // 25 % от 15 300
  assert.equal(result.total, 19125); // 15 300 + 3 825 — итог ДО НДС
  assert.equal(result.vatRate, 20);
  assert.equal(result.vatIncluded, false);
  assert.equal(result.vat, 3825); // 20 % от 19 125
  assert.equal(result.gross, 22950); // 19 125 + 3 825
  assert.equal(result.rounding, null);
  assert.equal(result.worksMode, 'percent');
  assert.deepEqual(result.works, []);
  assert.deepEqual(result.sections.map(section => section.total), [10000, 500, 4800, 3825]);
  assert.equal(result.complete, true);
  assert.deepEqual(result.warnings, []);
});

test('НДС включён в цены: gross === total, vat = total × 20 / 120', () => {
  const project = base();
  project.estimate = { laborPercent: 25, vatRate: 20, vatIncluded: true };
  const result = estimate(project);

  assert.equal(result.total, 19125, 'total остаётся итогом до НДС');
  assert.equal(result.gross, 19125, 'цены уже включают НДС');
  // Без правила округления roundMoney не меняет значение: 19 125 × 20 / 120 = 3 187,5 ₽.
  assert.equal(result.vat, 3187.5);
  assert.equal(result.complete, true);
  assert.deepEqual(result.warnings, []);
});

test('работы по видам: строки, итог = Σ, процент игнорируется', () => {
  const project = base();
  const works: WorkLine[] = [
    { id: 'w1', name: 'Прокладка лотка', unit: 'м', quantity: 120, price: 180 },
    { id: 'w2', name: 'Монтаж точки', unit: 'точка', quantity: 5, price: 800 },
    { id: 'w3', name: 'Пусконаладка', unit: 'компл', quantity: 1, price: 2500 },
  ];
  project.estimate = { laborPercent: 25, works };
  const result = estimate(project);

  assert.equal(result.worksMode, 'items');
  assert.deepEqual(result.works, works);
  assert.equal(result.laborPercent, null, 'процент в режиме по видам не применяется');
  const section = result.sections[3];
  assert.equal(section.kind, 'work');
  assert.deepEqual(section.lines.map(line => [line.name, line.unit, line.quantity, line.price, line.total]), [
    ['Прокладка лотка', 'м', 120, 180, 21600],
    ['Монтаж точки', 'точка', 5, 800, 4000],
    ['Пусконаладка', 'компл', 1, 2500, 2500],
  ]);
  assert.deepEqual(section.lines.map(line => line.kind), ['work', 'work', 'work']);
  assert.equal(section.total, 28100); // 21 600 + 4 000 + 2 500
  assert.equal(section.complete, true);
  assert.equal(result.labor, 28100, 'работы = итог раздела по видам, а не процент');
  assert.equal(result.total, 43400); // 15 300 материалов + 28 100 работ
  assert.equal(result.gross, 43400, 'НДС не начислен');
  assert.equal(result.complete, true);
  assert.deepEqual(result.warnings, []);
});

test('неполная строка работ: null и предупреждение, смета неполная', () => {
  const project = base();
  project.estimate = {
    laborPercent: 25,
    works: [
      { id: 'w1', name: 'Прокладка лотка', unit: 'м', quantity: 120, price: 180 },
      { id: 'w2', name: 'Монтаж точки', unit: 'точка', quantity: 5, price: null },
    ],
    vatRate: 20,
  };
  const result = estimate(project);

  const section = result.sections[3];
  assert.equal(section.lines[1].total, null);
  assert.equal(section.total, null);
  assert.equal(section.complete, false);
  assert.ok(section.warnings.includes('Смета: неполная строка работ «Монтаж точки»'));
  assert.equal(result.labor, null);
  assert.equal(result.total, null);
  assert.equal(result.vat, null, 'при неизвестном итоге НДС не начисляется');
  assert.equal(result.gross, null);
  assert.equal(result.complete, false);
});

test('мусор в строке работ: без имени или с отрицательным количеством — null, а не 0', () => {
  for (const work of [
    { id: 'w1', name: '   ', unit: 'м', quantity: 120, price: 180 },
    { id: 'w1', name: 'Прокладка', unit: 'м', quantity: -5, price: 180 },
    { id: 'w1', name: 'Прокладка', unit: 'м', quantity: 120, price: Number.NaN },
    { id: 'w1', name: 'Прокладка', unit: 'м', quantity: Number.POSITIVE_INFINITY, price: 180 },
  ]) {
    const project = base();
    project.estimate = { laborPercent: 25, works: [work] };
    const result = estimate(project);
    const line = result.sections[3].lines[0];
    assert.equal(line.total, null, `работа ${JSON.stringify(work)}`);
    assert.equal(result.sections[3].complete, false);
    assert.equal(result.complete, false);
    assert.ok(result.warnings.some(warning => warning.startsWith('Смета: неполная строка работ')));
  }
});

test('округление 1 ₽: все деньги кратны 1, инварианты держатся', () => {
  // 5000.6×2 = 10001.2 → 10001; 50.6×10 = 506.000…6 → 506; 480.5×10 = 4805.
  const project = priced(5000.6, 50.6, 480.5);
  project.estimate = { laborPercent: 25, vatRate: 20, rounding: 1 };
  const result = estimate(project);

  assert.equal(result.rounding, 1);
  assert.equal(result.materials, 15312); // 10001 + 506 + 4805
  assert.equal(result.labor, 3828); // 25 % от уже округлённых 15 312
  assert.equal(result.total, 19140);
  assert.equal(result.vat, 3828); // 20 % от 19 140
  assert.equal(result.gross, 22968);
  assert.deepEqual(result.sections.map(section => section.total), [10001, 506, 4805, 3828]);

  const money = [
    result.materials,
    result.labor,
    result.total,
    result.vat,
    result.gross,
    ...result.sections.flatMap(section => [section.total, ...section.lines.map(line => line.total)]),
  ];
  assertMultiples(money, 1);
  const materialSections = result.sections.filter(section => section.kind !== 'work');
  assert.equal(result.materials, materialSections.reduce((sum, section) => sum + (section.total as number), 0));
  assert.equal(result.total, (result.materials as number) + (result.labor as number));
  assert.equal(result.gross, (result.total as number) + (result.vat as number));
  assert.equal(result.complete, true);
});

test('округление null: числа бит-в-бит как в 2.9.1 (сырые значения)', () => {
  // .5 и .75 точно представимы в двоичной дроби, поэтому эталон можно зашивать жёстко.
  const project = priced(5000.5, 50.5, 480.5);
  project.estimate = { laborPercent: 25, vatRate: 20 };
  const result = estimate(project);

  assert.equal(result.rounding, null);
  assert.equal(result.materials, 15311); // 10001 + 505 + 4805
  assert.equal(result.labor, 3827.75);
  assert.equal(result.total, 19138.75);
  assert.equal(result.vat, 3827.75);
  assert.equal(result.gross, 22966.5);
  assertMultiples([result.labor, result.total, result.vat, result.gross], 0.01);
});

test('неверная ставка НДС (150, −5, NaN) не начисляется и помечается предупреждением', () => {
  for (const vatRate of [150, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const project = base();
    project.estimate = { laborPercent: 25, vatRate };
    const result = estimate(project);
    assert.equal(result.vatRate, null, `ставка ${String(vatRate)}`);
    assert.equal(result.vat, null);
    assert.equal(result.gross, null);
    assert.equal(result.total, 19125, 'итог до НДС известен');
    assert.equal(result.complete, false, 'смета с некорректным НДС неполная');
    assert.ok(result.warnings.includes('Смета: неверная ставка НДС'), `ставка ${String(vatRate)}`);
  }
});

test('нулевая ставка НДС: не начисляется, но это не ошибка и смета полная', () => {
  for (const vatRate of [0, null]) {
    const project = base();
    project.estimate = { laborPercent: 25, vatRate };
    const result = estimate(project);
    assert.equal(result.vatRate, vatRate);
    assert.equal(result.vat, null);
    assert.equal(result.gross, 19125);
    assert.equal(result.complete, true);
    assert.deepEqual(result.warnings, []);
  }
});

test('неверное правило округления (3): не применяется, предупреждение', () => {
  const project = priced(5000.5, 50.5, 480.5);
  project.estimate = { laborPercent: 25, vatRate: 20, rounding: 3 };
  const result = estimate(project);

  assert.equal(result.rounding, null);
  assert.equal(result.total, 19138.75, 'значения не округляются');
  assert.equal(result.vat, 3827.75);
  assert.equal(result.gross, 22966.5);
  assert.ok(result.warnings.includes('Смета: неверное правило округления'));
});

test('roundMoney и нормализация: допустимые шаги, null и формула Math.round', () => {
  for (const rounding of [0.01, 1, 10, 100]) assert.equal(normalizeRounding(rounding), rounding);
  for (const rounding of [3, 0.5, -1, 0, Number.NaN, '1', null, undefined]) {
    assert.equal(normalizeRounding(rounding), null, `шаг ${String(rounding)}`);
  }
  assert.equal(roundMoney(10.4, 1), 10);
  assert.equal(roundMoney(10.5, 1), 11);
  assert.equal(roundMoney(1234.5678, 10), 1230);
  assert.equal(roundMoney(1234.5678, 100), 1200);
  assert.equal(roundMoney(12.34, 0.01), 12.34);
  assert.equal(roundMoney(12.3456, null), 12.3456);
});

test('normalizeWorks: битые элементы отбрасываются, поля обрезаются, дубли id разводятся', () => {
  assert.deepEqual(normalizeWorks([null, 'строка', 42]), []);
  assert.deepEqual(normalizeWorks('нет'), []);
  assert.deepEqual(
    normalizeWorks([{ name: '  Прокладка  ', unit: ' м ', quantity: '120', price: -1 }]),
    [{ id: 'work-1', name: 'Прокладка', unit: 'м', quantity: null, price: null }],
  );
  const ids = normalizeWorks([{ id: 'w', name: 'A' }, { id: 'w', name: 'B' }]).map(line => line.id);
  assert.equal(new Set(ids).size, ids.length, `дубли id: ${ids.join(', ')}`);
});

test('миграция: старый проект без новых полей считает как в 2.9.1', () => {
  const raw = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
  raw.estimate = { laborPercent: 25 };
  const migrated = migrateProject(raw);

  assert.deepEqual(migrated.estimate, { laborPercent: 25, note: '' });
  const result = estimate(migrated);
  assert.equal(result.materials, 15300);
  assert.equal(result.labor, 3825);
  assert.equal(result.total, 19125);
  assert.equal(result.worksMode, 'percent');
  assert.deepEqual(result.works, []);
  assert.equal(result.vatRate, null);
  assert.equal(result.vat, null);
  assert.equal(result.gross, 19125);
  assert.equal(result.rounding, null);
  assert.equal(result.complete, true);
});

test('миграция: мусорные works/vatRate/rounding нормализуются, note не теряется', () => {
  const raw = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
  raw.estimate = {
    laborPercent: 25,
    note: 'Примечание',
    works: [
      null,
      'строка',
      { id: 'w1', name: ' Прокладка лотка ', unit: ' м ', quantity: 120, price: 180 },
      { name: 'Монтаж', quantity: -5, price: Number.NaN },
    ],
    vatRate: 150,
    vatIncluded: 'да',
    rounding: 3,
  };
  const estimateData = migrateProject(raw).estimate;
  assert.deepEqual(estimateData, {
    laborPercent: 25,
    note: 'Примечание',
    works: [
      { id: 'w1', name: 'Прокладка лотка', unit: 'м', quantity: 120, price: 180 },
      { id: 'work-4', name: 'Монтаж', unit: 'шт', quantity: null, price: null },
    ],
    vatRate: null,
    rounding: null,
  });
  assert.deepEqual(estimate(migrateProject(raw)).works[0], { id: 'w1', name: 'Прокладка лотка', unit: 'м', quantity: 120, price: 180 });
  // Нормализованная смета переживает сохранение → загрузку без потерь.
  const migrated = migrateProject(raw);
  assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(migrated))).estimate, migrated.estimate);
});

test('миграция: пустой works не хранится, vatIncluded true сохраняется', () => {
  const raw = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
  raw.estimate = { laborPercent: 25, works: [], vatRate: 20, vatIncluded: true, rounding: 10 };
  const estimateData = migrateProject(raw).estimate!;
  assert.equal('works' in estimateData, false, 'пустой список работ — это отсутствие поля');
  assert.equal(estimateData.vatRate, 20);
  assert.equal(estimateData.vatIncluded, true);
  assert.equal(estimateData.rounding, 10);

  const falseIncluded = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
  falseIncluded.estimate = { laborPercent: 25, vatIncluded: false };
  assert.equal('vatIncluded' in migrateProject(falseIncluded).estimate!, false, 'храним только true');
});

test('assertProject принимает валидные новые поля сметы', () => {
  const project = base();
  project.estimate = {
    laborPercent: 25,
    note: '',
    works: [{ id: 'w1', name: 'Прокладка лотка', unit: 'м', quantity: 120, price: 180 }],
    vatRate: 20,
    vatIncluded: true,
    rounding: 1,
  };
  assert.doesNotThrow(() => assertProject(project, () => true));

  const nulls = base();
  nulls.estimate = { laborPercent: null, works: [], vatRate: null, vatIncluded: false, rounding: null };
  assert.doesNotThrow(() => assertProject(nulls, () => true));
});

test('assertProject отклоняет мусор в новых полях сметы (422)', () => {
  const cases: [unknown, RegExp][] = [
    [{ laborPercent: 25, works: 'нет' }, /project\.estimate\.works/],
    [{ laborPercent: 25, works: [null] }, /project\.estimate\.works: некорректная строка работ/],
    [{ laborPercent: 25, works: [{ id: 'w', name: 'X', unit: 'м', quantity: -1, price: 100 }] }, /project\.estimate\.works: некорректная строка работ/],
    [{ laborPercent: 25, works: [{ id: 'w', name: 'X', unit: 'м', quantity: 1, price: '100' }] }, /project\.estimate\.works: некорректная строка работ/],
    [{ laborPercent: 25, works: [{ name: 'X', unit: 'м', quantity: 1, price: 100 }] }, /project\.estimate\.works: некорректная строка работ/],
    [{ laborPercent: 25, vatRate: 150 }, /project\.estimate\.vatRate/],
    [{ laborPercent: 25, vatRate: -5 }, /project\.estimate\.vatRate/],
    [{ laborPercent: 25, vatRate: '20' }, /project\.estimate\.vatRate/],
    [{ laborPercent: 25, vatRate: Number.NaN }, /project\.estimate\.vatRate/],
    [{ laborPercent: 25, rounding: 3 }, /project\.estimate\.rounding/],
    [{ laborPercent: 25, rounding: '1' }, /project\.estimate\.rounding/],
    [{ laborPercent: 25, vatIncluded: 'да' }, /project\.estimate\.vatIncluded/],
    [{ laborPercent: 25, vatIncluded: 1 }, /project\.estimate\.vatIncluded/],
  ];
  for (const [estimateField, pattern] of cases) {
    const candidate = { ...base(), estimate: estimateField } as unknown;
    rejectsProject(candidate, pattern);
  }
});
