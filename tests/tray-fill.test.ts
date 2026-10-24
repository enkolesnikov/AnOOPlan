import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRAY_FILL_LIMIT_PERCENT,
  TRAY_FILL_RECOMMENDED_PERCENT,
  cableSection,
  calculateCable,
  domainWarnings,
  routeAngleStats,
  routeSectionLengths,
  routeSectionsText,
  routeSummary,
  specificationKnS,
  specifications,
  suggestRouteSection,
  suggestSegmentSection,
  trayFill,
  validateProject,
} from '../src/engine';
import { createDemoProject } from '../src/demo';
import type { Cable, Equipment, Project, Route, Segment, Vertex } from '../src/model';

const vertex = (id: string, x: number, y = 0, height: number | null = 3, floorId = 'f1'): Vertex => ({ id, x, y, height, floorId });
const segment = (id: string, a: Vertex, b: Vertex): Segment => ({ id, a, b, mode: 'orthogonal', reservePercent: 0, reserveFixed: 0 });
const device = (id: string, x: number, height: number | null = 1, floorId = 'f1'): Equipment => ({ id, number: id.toUpperCase(), name: `Устройство ${id}`, type: 'Камера', floorId, x, y: 0, height, note: '', properties: { model: 'К-1' } });
const route = (number: string, segments: Segment[], extra: Partial<Route> = {}): Route => ({ id: `r-${number}`, number, type: 'Лоток', note: '', segments, ...extra });
const cable = (number: string, segmentIds: string[], extra: Partial<Cable> = {}): Cable => ({
  id: `c-${number}`, number, name: `Линия ${number}`, brand: 'КВК-П', purpose: '',
  fromId: 'a', toId: 'b', segmentIds, reservePercent: 0, reserveFixed: 0,
  startReserve: 0, endReserve: 0, quantity: 1, note: '', ...extra,
});
const line = (id: string, extra: Partial<Segment> = {}): Segment => ({ ...segment(id, vertex(`${id}-a`, 0), vertex(`${id}-b`, 100)), ...extra });

function baseProject(routes: Route[], cables: Cable[] = []): Project {
  return {
    schemaVersion: 2, id: 'p', name: 'Заполнение лотка', updatedAt: '2026-01-01T00:00:00Z',
    floors: [{ id: 'f1', name: 'Первый', elevation: 0, metersPerUnit: 0.1, page: 1, width: 1000, height: 700 }],
    equipment: [device('a', 0), device('b', 100)],
    routes, cables, pins: [],
  };
}

const oneRoute = (extra: Partial<Route> = {}, cables: Cable[] = []) =>
  baseProject([route('Т1', [line('s1')], extra)], cables);
const close = (actual: number | null, expected: number, message = '') => {
  assert.notEqual(actual, null, message);
  assert.ok(Math.abs(actual! - expected) < 1e-6, `${actual} != ${expected} ${message}`);
};
const circleArea = (diameter: number) => Math.PI * diameter * diameter / 4;

test('cableSection: площадь по диаметру, сечение приоритетнее диаметра', () => {
  const byDiameter = cableSection(cable('Л1', ['s1'], { outerDiameterMm: 6 }));
  assert.equal(byDiameter.source, 'diameter');
  assert.ok(Math.abs((byDiameter.areaMm2 ?? 0) - circleArea(6)) < 1e-9);
  assert.deepEqual(byDiameter.errors, []);

  const byArea = cableSection(cable('Л2', ['s1'], { outerDiameterMm: 6, crossSectionMm2: 100 }));
  assert.equal(byArea.source, 'area');
  assert.equal(byArea.areaMm2, 100);
  assert.deepEqual(byArea.errors, []);

  assert.deepEqual(cableSection(cable('Л3', ['s1'])), { areaMm2: null, source: null, errors: [] });
});

test('некорректные сечение и диаметр дают ошибку и null без фолбэка', () => {
  assert.deepEqual(
    cableSection(cable('Л1', ['s1'], { crossSectionMm2: 0, outerDiameterMm: 6 })),
    { areaMm2: null, source: null, errors: ['Кабель Л1: неверная площадь сечения'] },
  );
  assert.deepEqual(
    cableSection(cable('Л2', ['s1'], { outerDiameterMm: -5 })),
    { areaMm2: null, source: null, errors: ['Кабель Л2: неверный внешний диаметр'] },
  );
  const nanDiameter = cableSection(cable('Л3', ['s1'], { outerDiameterMm: Number.NaN }));
  assert.equal(nanDiameter.areaMm2, null);
  assert.equal(nanDiameter.source, null);
  assert.ok(nanDiameter.errors.length > 0);
});

test('пустой лоток с известной площадью: empty и 0 %', () => {
  const result = trayFill(oneRoute({ trayWidthMm: 100, trayHeightMm: 50 }));
  assert.equal(result.segments.length, 1);
  const [fill] = result.segments;
  assert.equal(fill.status, 'empty');
  assert.equal(fill.fillPercent, 0);
  assert.equal(fill.usedAreaMm2, 0);
  assert.equal(fill.trayAreaMm2, 5000);
  assert.equal(fill.cables, 0);
  assert.equal(fill.lines, 0);
  assert.equal(fill.unknownCables, 0);
  assert.equal(result.maxFillPercent, 0);
  assert.equal(result.overSegments, 0);
  assert.equal(result.complete, true);
  assert.deepEqual(result.warnings, []);
});

test('пустая трасса без размеров лотка не спамит предупреждениями', () => {
  const result = trayFill(oneRoute());
  const [fill] = result.segments;
  assert.equal(fill.status, 'empty');
  assert.equal(fill.fillPercent, null);
  assert.equal(fill.trayAreaMm2, null);
  assert.equal(result.complete, true);
  assert.deepEqual(result.warnings, []);
});

test('заполнение больше 50 %: status over и предупреждение о пределе', () => {
  const p = oneRoute({ trayWidthMm: 50, trayHeightMm: 50 }, [cable('Л3', ['s1'], { crossSectionMm2: 400, quantity: 4 })]);
  const result = trayFill(p);
  const [fill] = result.segments;
  assert.equal(fill.status, 'over');
  close(fill.fillPercent, 64);
  assert.equal(fill.usedAreaMm2, 1600);
  assert.equal(fill.trayAreaMm2, 2500);
  assert.equal(result.overSegments, 1);
  close(result.maxFillPercent, 64);
  assert.ok(result.warnings.includes('Трасса Т1, сегмент Т1.1: заполнение 64 % — превышен предел 50 %'));
  assert.equal(TRAY_FILL_LIMIT_PERCENT, 50);
});

test('заполнение 40–50 %: status warning и рекомендация 40 %', () => {
  const p = oneRoute({ trayAreaMm2: 5000 }, [cable('Л2', ['s1'], { crossSectionMm2: 230, quantity: 10 })]);
  const result = trayFill(p);
  assert.equal(result.segments[0].status, 'warning');
  close(result.segments[0].fillPercent, 46);
  assert.ok(result.warnings.includes('Трасса Т1, сегмент Т1.1: заполнение 46 % — больше рекомендуемых 40 %'));
  assert.equal(result.overSegments, 0);
  assert.equal(result.complete, true);
  assert.equal(TRAY_FILL_RECOMMENDED_PERCENT, 40);
});

test('границы: ровно 40 % — ok, ровно 50 % — warning', () => {
  const p = oneRoute({ trayWidthMm: 100, trayHeightMm: 50 }, [cable('Л1', ['s1'], { crossSectionMm2: 100, quantity: 20 })]);
  close(trayFill(p).segments[0].fillPercent, 40);
  assert.equal(trayFill(p).segments[0].status, 'ok');
  p.cables[0].quantity = 25;
  const [fill] = trayFill(p).segments;
  close(fill.fillPercent, 50);
  assert.equal(fill.status, 'warning');
});

test('площади разных кабелей и количества суммируются', () => {
  const p = oneRoute({ trayAreaMm2: 5000 }, [
    cable('Л1', ['s1'], { outerDiameterMm: 6 }),
    cable('Л2', ['s1'], { outerDiameterMm: 10, quantity: 2 }),
  ]);
  const [fill] = trayFill(p).segments;
  const expected = circleArea(6) + circleArea(10) * 2;
  close(fill.usedAreaMm2, expected);
  close(fill.fillPercent, expected / 5000 * 100);
  assert.equal(fill.cables, 2);
  assert.equal(fill.lines, 3);
  assert.equal(fill.unknownCables, 0);
  assert.equal(fill.status, 'ok');
});

test('неизвестное сечение кабеля даёт incomplete и null, а не 0', () => {
  const p = oneRoute({ trayWidthMm: 100, trayHeightMm: 50 }, [cable('Л3', ['s1'])]);
  const result = trayFill(p);
  const [fill] = result.segments;
  assert.equal(fill.status, 'incomplete');
  assert.equal(fill.fillPercent, null);
  assert.equal(fill.usedAreaMm2, null);
  assert.equal(fill.unknownCables, 1);
  assert.equal(result.complete, false);
  assert.equal(result.maxFillPercent, null);
  assert.ok(result.warnings.includes('Трасса Т1, сегмент Т1.1: не задано сечение кабеля Л3 — заполнение не рассчитано'));
});

test('несколько неизвестных кабелей перечисляются в одном предупреждении', () => {
  const p = oneRoute({ trayWidthMm: 100, trayHeightMm: 50 }, [cable('Л3', ['s1']), cable('Л4', ['s1'])]);
  const result = trayFill(p);
  assert.equal(result.segments[0].unknownCables, 2);
  assert.ok(result.warnings.some(warning => warning.includes('не задано сечение кабелей Л3, Л4')));
});

test('неизвестные размеры лотка: incomplete и предупреждение по трассе', () => {
  const p = oneRoute({}, [cable('Л1', ['s1'], { outerDiameterMm: 6 })]);
  const result = trayFill(p);
  const [fill] = result.segments;
  assert.equal(fill.status, 'incomplete');
  assert.equal(fill.fillPercent, null);
  assert.equal(fill.trayAreaMm2, null);
  close(fill.usedAreaMm2, circleArea(6));
  assert.equal(result.complete, false);
  assert.ok(result.warnings.includes('Трасса Т1: не задано сечение КНС — заполнение не рассчитано'));
});

test('некорректная площадь лотка не подменяется шириной и высотой', () => {
  const p = oneRoute(
    { trayAreaMm2: 0, trayWidthMm: 100, trayHeightMm: 50 },
    [cable('Л1', ['s1'], { crossSectionMm2: 100 })],
  );
  const result = trayFill(p);
  const [fill] = result.segments;
  assert.equal(fill.trayAreaMm2, null);
  assert.equal(fill.status, 'incomplete');
  assert.ok(result.warnings.includes('Трасса Т1: неверное сечение КНС — заполнение не рассчитано'));
});

test('неверное количество кабеля делает сегмент неполным', () => {
  const p = oneRoute({ trayAreaMm2: 5000 }, [cable('Л5', ['s1'], { crossSectionMm2: 100, quantity: 0 })]);
  const [fill] = trayFill(p).segments;
  assert.equal(fill.status, 'incomplete');
  assert.equal(fill.usedAreaMm2, null);
  assert.equal(fill.unknownCables, 1);
  assert.equal(fill.lines, 0);
  assert.ok(fill.warnings.some(warning => warning.includes('неверное количество кабеля Л5')));
});

test('specifications: строки trayFill и статистика заполнения по типам', () => {
  const s1 = segment('s1', vertex('va', 0), vertex('vm', 50));
  const s2 = segment('s2', vertex('vm', 50), vertex('vb', 100));
  const s3 = segment('s3', vertex('v2a', 0), vertex('v2b', 50));
  const p = baseProject([
    route('Т1', [s1, s2], { trayWidthMm: 100, trayHeightMm: 50 }),
    route('Т2', [s3], { type: 'Стояк', trayWidthMm: 50, trayHeightMm: 50 }),
  ], [
    cable('Л1', ['s1'], { crossSectionMm2: 100, quantity: 20 }),
    cable('Л2', ['s2'], { crossSectionMm2: 100, quantity: 30 }),
  ]);
  const spec = specifications(p);
  assert.equal(spec.trayFill.length, 3);
  assert.deepEqual(spec.trayFill[0], {
    route: 'Т1', segment: 'Т1.1', routeType: 'Лоток', tray: '100×50',
    trayAreaMm2: 5000, lines: 20, areaMm2: 2000, fillPercent: 40, status: 'ок', overridden: false,
  });
  assert.equal(spec.trayFill[1].segment, 'Т1.2');
  assert.equal(spec.trayFill[1].status, 'превышено');
  close(spec.trayFill[1].fillPercent, 60);
  assert.deepEqual(spec.trayFill[2], {
    route: 'Т2', segment: 'Т2.1', routeType: 'Стояк', tray: '50×50',
    trayAreaMm2: 2500, lines: 0, areaMm2: 0, fillPercent: 0, status: 'пусто', overridden: false,
  });
  const trayGroup = spec.infrastructure.find(group => group.type === 'Лоток');
  const riserGroup = spec.infrastructure.find(group => group.type === 'Стояк');
  assert.ok(trayGroup);
  assert.ok(riserGroup);
  close(trayGroup.maxFillPercent, 60);
  assert.equal(trayGroup.overSegments, 1);
  assert.equal(riserGroup.maxFillPercent, 0);
  assert.equal(riserGroup.overSegments, 0);
});

test('обозначение лотка: размеры, площадь или прочерк', () => {
  const p = baseProject([
    route('Т1', [line('s1')], { trayAreaMm2: 5000 }),
    route('Т2', [line('s2')]),
  ]);
  const rows = specifications(p).trayFill;
  assert.equal(rows[0].tray, 'S=5000 мм²');
  assert.equal(rows[0].trayAreaMm2, 5000);
  assert.equal(rows[1].tray, '—');
  assert.equal(rows[1].status, 'пусто');
});

test('гофра и труба: площадь считается по внутреннему диаметру', () => {
  const p = oneRoute({ type: 'Гофра', trayWidthMm: 20 }, [cable('Л1', ['s1'], { crossSectionMm2: 50 })]);
  const fill = trayFill(p);
  close(fill.segments[0].trayAreaMm2, Math.PI * 100);
  close(fill.segments[0].fillPercent, 50 / (Math.PI * 100) * 100);
  assert.equal(fill.segments[0].trayHeightMm, null, 'высота борта у круглой КНС не используется');
  const rows = specifications(p).trayFill;
  assert.equal(rows[0].routeType, 'Гофра');
  assert.equal(rows[0].tray, 'Ø20');

  const pipe = oneRoute({ type: 'Труба', trayWidthMm: 25 }, [cable('Л2', ['s1'], { crossSectionMm2: 100 })]);
  close(trayFill(pipe).segments[0].trayAreaMm2, Math.PI * 25 * 25 / 4);
  assert.equal(specifications(pipe).trayFill[0].tray, 'Ø25');
});

test('труба: явная площадь приоритетнее диаметра', () => {
  const p = oneRoute({ type: 'Труба', trayWidthMm: 20, trayAreaMm2: 500 }, [cable('Л1', ['s1'], { crossSectionMm2: 50 })]);
  const fill = trayFill(p);
  assert.equal(fill.segments[0].trayAreaMm2, 500);
  close(fill.segments[0].fillPercent, 10);
  assert.equal(specifications(p).trayFill[0].tray, 'S=500 мм²');
});

test('неверный диаметр гофры не подменяется и даёт warning', () => {
  const p = oneRoute({ type: 'Гофра', trayWidthMm: -10 }, [cable('Л1', ['s1'], { crossSectionMm2: 50 })]);
  const fill = trayFill(p);
  assert.equal(fill.segments[0].status, 'incomplete');
  assert.equal(fill.segments[0].trayAreaMm2, null);
  assert.ok(fill.warnings.includes('Трасса Т1: неверное сечение КНС — заполнение не рассчитано'));
});

test('domainWarnings добавляет предупреждения о превышении заполнения', () => {
  const p = oneRoute({ trayWidthMm: 50, trayHeightMm: 50 }, [cable('Л3', ['s1'], { crossSectionMm2: 400, quantity: 4 })]);
  const warnings = domainWarnings(p);
  assert.ok(warnings.some(warning => warning.includes('превышен предел 50 %')));
  assert.ok(warnings.some(warning => warning.includes('не задана цена за метр')));
  assert.equal(new Set(warnings).size, warnings.length);
});

test('validateProject ловит только заданные некорректные значения', () => {
  const p = oneRoute({ trayWidthMm: 0, trayHeightMm: 50 }, [
    cable('Л1', ['s1'], { outerDiameterMm: Number.NaN }),
    cable('Л2', ['s1'], { crossSectionMm2: -5 }),
  ]);
  const errors = validateProject(p);
  assert.ok(errors.includes('Трасса Т1: неверное сечение КНС'));
  assert.ok(errors.includes('Кабель Л1: неверный внешний диаметр'));
  assert.ok(errors.includes('Кабель Л2: неверная площадь сечения'));

  const ok = oneRoute({ trayWidthMm: 100, trayHeightMm: 50 }, [cable('Л1', ['s1'], { outerDiameterMm: 6 })]);
  assert.deepEqual(validateProject(ok), []);
});

test('демо-проект: заполнение известно и в норме на всех 7 сегментах', () => {
  const demo = createDemoProject();
  const result = trayFill(demo);
  assert.equal(result.segments.length, 7);
  assert.equal(result.complete, true);
  assert.equal(result.overSegments, 0);
  for (const fill of result.segments) {
    assert.notEqual(fill.fillPercent, null, `сегмент ${fill.segmentId} без процента`);
    assert.equal(fill.status, 'ok');
    assert.ok(fill.fillPercent! > 0 && fill.fillPercent! < TRAY_FILL_RECOMMENDED_PERCENT);
  }
  assert.ok(result.maxFillPercent !== null && result.maxFillPercent > 0);
  assert.ok(result.maxFillPercent! < TRAY_FILL_RECOMMENDED_PERCENT);
  const spec = specifications(demo);
  assert.equal(spec.trayFill.length, 7);
  assert.ok(spec.trayFill.every(row => row.status === 'ок'));
  assert.ok(spec.infrastructure.every(row => row.maxFillPercent !== null && row.maxFillPercent > 0));
});

test('демо-проект: новые поля не изменили метраж кабелей', () => {
  const demo = createDemoProject();
  const totals = demo.cables.map(item => calculateCable(demo, item).total);
  close(totals[0], 15.3);
  close(totals[1], 26.3);
  close(totals[2], 45.55);
  close(totals[3], 27.95);
});

// --- Сегментные размеры КНС (2.5.0) ---
// В одной трассе могут быть разные лотки/трубы: размеры сегмента переопределяют размеры трассы
// по каждому полю отдельно, а метраж, заполнение и спецификация идут по эффективному сечению.

const chain = (dims: Partial<Segment>[]): Segment[] => {
  let x = 0;
  return dims.map((extra, index) => {
    const a = vertex(`v${index}`, x);
    x += 50;
    const b = vertex(`v${index + 1}`, x);
    return { ...segment(`s${index + 1}`, a, b), ...extra };
  });
};

test('сегмент со своим сечением: заполнение и ведомость считают по нему', () => {
  const [s1, s2] = chain([{}, { trayWidthMm: 50, trayHeightMm: 50 }]);
  const p = baseProject([route('Т1', [s1, s2], { trayWidthMm: 100, trayHeightMm: 50 })], [
    cable('Л1', ['s1'], { crossSectionMm2: 100, quantity: 5 }),
    cable('Л2', ['s2'], { crossSectionMm2: 100, quantity: 10 }),
  ]);
  const fill = trayFill(p);
  assert.equal(fill.complete, true);
  const [first, second] = fill.segments;
  assert.equal(first.trayAreaMm2, 5000, 'сегмент без override использует лоток трассы');
  assert.equal(first.overridden, false);
  assert.equal(first.sectionLabel, '100×50');
  close(first.fillPercent, 5 * 100 / 5000 * 100);
  assert.equal(second.trayAreaMm2, 2500, 'свой лоток 50×50');
  assert.equal(second.trayWidthMm, 50);
  assert.equal(second.trayHeightMm, 50);
  assert.equal(second.overridden, true);
  assert.equal(second.sectionLabel, '50×50');
  close(second.fillPercent, 10 * 100 / 2500 * 100);

  const rows = specifications(p).trayFill;
  assert.equal(rows[0].tray, '100×50');
  assert.equal(rows[0].overridden, false);
  assert.equal(rows[1].tray, '50×50');
  assert.equal(rows[1].overridden, true);
  assert.equal(rows[1].trayAreaMm2, 2500);
});

test('переопределение по полям: незаданная высота наследуется от трассы', () => {
  const [s1, s2] = chain([{}, { trayWidthMm: 50 }]);
  const p = baseProject([route('Т1', [s1, s2], { trayWidthMm: 100, trayHeightMm: 50 })]);
  const [, second] = trayFill(p).segments;
  assert.equal(second.trayWidthMm, 50);
  assert.equal(second.trayHeightMm, 50, 'высота борта взята с трассы');
  assert.equal(second.trayAreaMm2, 2500);
});

test('гофра: диаметр на сегменте, высота борта не используется', () => {
  const [s1, s2] = chain([{}, { trayWidthMm: 40 }]);
  const p = baseProject([route('Т1', [s1, s2], { type: 'Гофра', trayWidthMm: 20 })], [
    cable('Л1', ['s2'], { crossSectionMm2: 50 }),
  ]);
  const [, second] = trayFill(p).segments;
  assert.equal(second.sectionLabel, 'Ø40');
  assert.equal(second.trayHeightMm, null);
  close(second.trayAreaMm2, circleArea(40));
  close(second.fillPercent, 50 / circleArea(40) * 100);
  assert.equal(specifications(p).trayFill[1].tray, 'Ø40');
});

test('площадь на сегменте приоритетнее его размеров, затем идут размеры трассы', () => {
  const [s1, s2] = chain([{}, { trayAreaMm2: 1200, trayWidthMm: 999, trayHeightMm: 999 }]);
  const p = baseProject([route('Т1', [s1, s2], { trayWidthMm: 100, trayHeightMm: 50 })]);
  const [, second] = trayFill(p).segments;
  assert.equal(second.trayAreaMm2, 1200);
  assert.equal(second.sectionLabel, 'S=1200 мм²');
  assert.equal(specifications(p).trayFill[1].tray, 'S=1200 мм²');
});

test('неверное сечение на сегменте: предупреждение, incomplete и ошибка валидации', () => {
  const [s1, s2] = chain([{}, { trayWidthMm: 0 }]);
  const p = baseProject([route('Т1', [s1, s2], { trayWidthMm: 100, trayHeightMm: 50 })], [
    cable('Л1', ['s1'], { crossSectionMm2: 100, quantity: 1 }),
    cable('Л2', ['s2'], { crossSectionMm2: 100, quantity: 1 }),
  ]);
  const fill = trayFill(p);
  assert.equal(fill.segments[0].status, 'ok', 'соседний сегмент считается как раньше');
  assert.equal(fill.segments[1].status, 'incomplete');
  assert.equal(fill.segments[1].trayAreaMm2, null);
  assert.ok(fill.warnings.some(warning => warning.includes('Трасса Т1, сегмент Т1.2: неверное сечение КНС')));
  assert.equal(fill.complete, false);
  assert.ok(validateProject(p).includes('Трасса Т1, сегмент Т1.2: неверное сечение КНС'));

  // Если на всех сегментах есть свои размеры, неверный размер трассы не мешает заполнению.
  const overridden = baseProject([route('Т1', [chain([{ trayWidthMm: 40, trayHeightMm: 40 }])[0]], { trayWidthMm: 0, trayHeightMm: 0 })], [
    cable('Л1', ['s1'], { crossSectionMm2: 100, quantity: 1 }),
  ]);
  const overriddenFill = trayFill(overridden);
  assert.equal(overriddenFill.segments[0].status, 'ok');
  assert.equal(overriddenFill.segments[0].overridden, true);
  assert.equal(overriddenFill.warnings.length, 0);
  assert.ok(validateProject(overridden).includes('Трасса Т1: неверное сечение КНС'), 'размер трассы всё равно проверяется');
});

test('routeSummary: метраж по сечениям и итоги по типам КНС', () => {
  const [s1, s2, s3] = chain([{}, { trayWidthMm: 50, trayHeightMm: 50 }, {}]);
  const p = baseProject([route('Т1', [s1, s2, s3], { trayWidthMm: 100, trayHeightMm: 50 })]);
  const summary = routeSummary(p);
  const row = summary.routes[0];
  assert.equal(row.sections.length, 2);
  assert.deepEqual(row.sections[0], { section: '100×50', length: 10, segments: 2, overridden: false });
  assert.deepEqual(row.sections[1], { section: '50×50', length: 5, segments: 1, overridden: true });
  assert.equal(routeSectionsText(row.sections, value => (value === null ? '—' : String(value))), '100×50 — 10 м; 50×50 — 5 м');
  assert.equal(row.length, 15, 'общая длина трассы не изменилась');
  assert.equal(summary.groups[0].length, 15);
  assert.equal(routeSectionLengths(p, p.routes[0]).length, 2);
});

test('спецификация КНС: сечения одной трассы — отдельные строки, углы не задваиваются', () => {
  // Трасса коробов с поворотом 90° на стыке второго и третьего сегментов.
  const segments: Segment[] = [
    segment('s1', vertex('a1', 0, 0), vertex('b1', 50, 0)),
    segment('s2', vertex('b1', 50, 0), vertex('b2', 50, 50)),
    { ...segment('s3', vertex('b2', 50, 50), vertex('b3', 100, 50)), trayWidthMm: 50, trayHeightMm: 50 },
  ];
  const project = baseProject([route('К1', segments, {
    type: 'Кабель-канал', trayWidthMm: 100, trayHeightMm: 50, subsystem: 'horizontal',
    },
  )], []);
  project.catalog = [
    { id: 'p1', kind: 'tray', name: 'Кабель-канал', unit: 'м', price: 300, note: '', article: 'KC-100', manufacturer: 'Завод' },
  ];
  const angles = routeAngleStats(project.routes[0]);
  assert.equal(angles.total, 2, 'два поворота 90° (Г-образная трасса)');
  const spec = specificationKnS(project);
  assert.equal(spec.lines.length, 2);
  const wide = spec.lines.find(line => line.section === '100×50');
  const narrow = spec.lines.find(line => line.section === '50×50');
  assert.ok(wide && narrow);
  assert.equal(wide.quantity, 10);
  assert.equal(wide.angles, 2, 'углы отнесены к основному сечению');
  assert.equal(wide.article, 'KC-100');
  assert.equal(narrow.quantity, 5);
  assert.equal(narrow.angles, 0);
  close(spec.totalCost, 15 * 300);
  assert.equal(spec.totals.find(item => item.group === 'Кабель-канал')?.angles, 2);
});

test('suggestRouteSection и suggestSegmentSection: сегменты со своим сечением не смешиваются', () => {
  const [s1, s2] = chain([{}, { trayWidthMm: 50, trayHeightMm: 50 }]);
  const p = baseProject([route('Т1', [s1, s2], { trayWidthMm: 100, trayHeightMm: 50 })], [
    cable('Л1', ['s1'], { crossSectionMm2: 400, quantity: 3 }),
    cable('Л2', ['s2'], { crossSectionMm2: 100, quantity: 2 }),
  ]);
  const routeSuggestion = suggestRouteSection(p, p.routes[0]);
  assert.ok(routeSuggestion, 'подбор по сегментам без override');
  assert.ok(routeSuggestion.widthMm * (routeSuggestion.heightMm ?? 0) >= 1200);
  const segmentSuggestion = suggestSegmentSection(p, p.routes[0], s2);
  assert.ok(segmentSuggestion);
  assert.ok(segmentSuggestion.label.startsWith('50×50'), `подбор для сегмента: ${segmentSuggestion.label}`);

  const allOverridden = baseProject([route('Т2', [chain([{ trayWidthMm: 50, trayHeightMm: 50 }])[0]], { trayWidthMm: 100, trayHeightMm: 50 })], [
    cable('Л3', ['s1'], { crossSectionMm2: 400 }),
  ]);
  assert.equal(suggestRouteSection(allOverridden, allOverridden.routes[0]), null, 'подбор трассы не трогает сегменты со своим сечением');
});
