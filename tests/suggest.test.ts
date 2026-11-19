import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestRouteSection, suggestSegmentSection } from '../src/engine';
import type { Cable, Project, Route, Segment, Vertex } from '../src/model';

const vertex = (id: string, x: number): Vertex => ({ id, x, y: 0, height: 3, floorId: 'f1' });
const segment = (id: string, extra: Partial<Segment> = {}): Segment => ({
  id,
  a: vertex(`${id}-a`, 0),
  b: vertex(`${id}-b`, 100),
  mode: 'orthogonal',
  reservePercent: 0,
  reserveFixed: 0,
  ...extra,
});
const route = (number: string, segments: Segment[], extra: Partial<Route> = {}): Route => ({
  id: `r-${number}`, number, type: 'Лоток', note: '', segments, ...extra,
});
const cable = (number: string, segmentIds: string[], extra: Partial<Cable> = {}): Cable => ({
  id: `c-${number}`, number, name: `Линия ${number}`, brand: 'ВВГ', purpose: '',
  fromId: 'a', toId: 'b', segmentIds, reservePercent: 0, reserveFixed: 0,
  startReserve: 0, endReserve: 0, quantity: 1, note: '', ...extra,
});
const project = (routes: Route[], cables: Cable[]): Project => ({
  schemaVersion: 2, id: 'p', name: 'Подбор сечения', floors: [], equipment: [],
  routes, cables, pins: [], updatedAt: '2026-01-01T00:00:00Z',
});
const close = (actual: number | null, expected: number, message = '') => {
  assert.notEqual(actual, null, message);
  assert.ok(Math.abs(actual! - expected) < 1e-6, `${actual} != ${expected} ${message}`);
};
const circleArea = (diameter: number) => Math.PI * diameter * diameter / 4;

test('suggestSegmentSection: соседний сегмент с толстым кабелем не завышает подбор', () => {
  const [thin, thick] = [segment('s1'), segment('s2')];
  const p = project([route('Т1', [thin, thick], { type: 'Гофра' })], [
    cable('Л1', ['s1'], { outerDiameterMm: 6, quantity: 1 }),
    cable('Л2', ['s2'], { outerDiameterMm: 20, quantity: 3 }),
  ]);

  const suggestion = suggestSegmentSection(p, p.routes[0], thin);
  assert.ok(suggestion, 'данных по тонкому кабелю достаточно');
  assert.equal(suggestion.kind, 'diameter');
  assert.equal(suggestion.widthMm, 16, 'диаметр кабеля соседнего сегмента не учитывается');
  close(suggestion.fillPercent, circleArea(6) / circleArea(16) * 100);
});

test('suggestSegmentSection и suggestRouteSection: кабель без сечения — null', () => {
  const [s1] = [segment('s1')];
  const p = project([route('Т1', [s1])], [
    cable('Л1', ['s1'], { crossSectionMm2: 100, quantity: 1 }),
    cable('Л2', ['s1'], { quantity: 1 }),
  ]);

  assert.equal(suggestSegmentSection(p, p.routes[0], s1), null, 'частичный расчёт недопустим');
  assert.equal(suggestRouteSection(p, p.routes[0]), null, 'частичный расчёт недопустим');
});

test('suggestSegmentSection и suggestRouteSection: неверное количество — null', () => {
  for (const quantity of [0, 1.5, Number.NaN]) {
    const s1 = segment('s1');
    const p = project([route('Т1', [s1])], [
      cable('Л1', ['s1'], { crossSectionMm2: 100, quantity: 1 }),
      cable('Л2', ['s1'], { crossSectionMm2: 100, quantity }),
    ]);
    assert.equal(suggestSegmentSection(p, p.routes[0], s1), null, `quantity=${quantity}`);
    assert.equal(suggestRouteSection(p, p.routes[0]), null, `quantity=${quantity}`);
  }
});

test('полные данные: прежняя рекомендация прямоугольного лотка', () => {
  const p = project([route('Т1', [segment('s1')])], [
    cable('Л1', ['s1'], { crossSectionMm2: 100, quantity: 2 }),
  ]);

  const suggestion = suggestRouteSection(p, p.routes[0]);
  assert.ok(suggestion);
  assert.deepEqual(
    { kind: suggestion.kind, widthMm: suggestion.widthMm, heightMm: suggestion.heightMm, areaMm2: suggestion.areaMm2 },
    { kind: 'rectangle', widthMm: 50, heightMm: 50, areaMm2: 2500 },
  );
  close(suggestion.fillPercent, 200 / 2500 * 100);
  assert.equal(suggestion.label, '50×50 (заполнение 8 %)');

  const segmentSuggestion = suggestSegmentSection(p, p.routes[0], p.routes[0].segments[0]);
  assert.ok(segmentSuggestion);
  assert.equal(segmentSuggestion.label, suggestion.label);
});

test('полные данные без заданного сечения КНС: прежняя рекомендация гофры', () => {
  const p = project([route('Т1', [segment('s1')], { type: 'Гофра' })], [
    cable('Л1', ['s1'], { outerDiameterMm: 10, quantity: 1 }),
  ]);

  const suggestion = suggestRouteSection(p, p.routes[0]);
  assert.ok(suggestion, 'отсутствие текущего сечения не мешает подбору');
  assert.equal(suggestion.kind, 'diameter');
  assert.equal(suggestion.widthMm, 16);
  assert.equal(suggestion.heightMm, null);
  close(suggestion.fillPercent, circleArea(10) / circleArea(16) * 100);
});

test('suggestRouteSection: кабели сегментов с override не влияют на диаметр', () => {
  const [plain, overridden] = [segment('s1'), segment('s2', { trayWidthMm: 50 })];
  const p = project([route('Т1', [plain, overridden], { type: 'Гофра' })], [
    cable('Л1', ['s1'], { outerDiameterMm: 6, quantity: 1 }),
    cable('Л2', ['s2'], { outerDiameterMm: 40, quantity: 3 }),
  ]);

  const suggestion = suggestRouteSection(p, p.routes[0]);
  assert.ok(suggestion);
  assert.equal(suggestion.widthMm, 16, 'Ø40 с переопределённого сегмента не учитывается');
});

test('неполные данные на сегменте с override не мешают подбору трассы', () => {
  const [plain, overridden] = [segment('s1'), segment('s2', { trayWidthMm: 50 })];
  const p = project([route('Т1', [plain, overridden], { type: 'Гофра' })], [
    cable('Л1', ['s1'], { outerDiameterMm: 6, quantity: 1 }),
    cable('Л2', ['s2']),
  ]);
  const target = p.routes[0];

  const suggestion = suggestRouteSection(p, target);
  assert.ok(suggestion, 'override-сегмент исключён из анализа');
  assert.equal(suggestion.widthMm, 16);
  assert.equal(suggestSegmentSection(p, target, overridden), null, 'для самого сегмента данных мало');
});
