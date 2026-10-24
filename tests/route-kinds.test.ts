import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTE_DEFAULT_COLOR,
  ROUTE_KIND_PRESETS,
  defaultRouteColor,
  isDiameterRoute,
  normalizeRouteColor,
  routeColor,
  routeKindOf,
  routeKindPreset,
  routeSectionLabel,
} from '../src/route-kinds';
import { migrateProject } from '../src/migrations';
import type { Project, Route } from '../src/model';

const route = (extra: Partial<Route> = {}): Route => ({
  id: 'r1', number: 'Т1', type: 'Лоток', note: '', segments: [], ...extra,
});

test('пресеты КНС: четыре типа, свои подписи и цвета', () => {
  assert.deepEqual(ROUTE_KIND_PRESETS.map(preset => preset.label), ['Лоток', 'Гофра', 'Труба', 'Кабель-канал']);
  assert.deepEqual(ROUTE_KIND_PRESETS.map(preset => preset.type), ['Лоток', 'Гофра', 'Труба', 'Кабель-канал']);
  const colors = ROUTE_KIND_PRESETS.map(preset => preset.color);
  assert.equal(new Set(colors).size, colors.length, 'цвета типов должны различаться');
  for (const preset of ROUTE_KIND_PRESETS) assert.match(preset.color, /^#[0-9a-f]{6}$/);
  assert.equal(ROUTE_KIND_PRESETS.find(preset => preset.id === 'tray')?.section, 'rectangle');
  assert.equal(ROUTE_KIND_PRESETS.find(preset => preset.id === 'corrugated')?.section, 'diameter');
  assert.equal(ROUTE_KIND_PRESETS.find(preset => preset.id === 'pipe')?.section, 'diameter');
  assert.equal(ROUTE_KIND_PRESETS.find(preset => preset.id === 'trunking')?.section, 'rectangle');
});

test('вид КНС распознаётся по свободному названию типа', () => {
  const cases: [string, ReturnType<typeof routeKindOf>][] = [
    ['Лоток', 'tray'],
    ['лоток лестничный', 'tray'],
    ['ЛОТКИ', 'tray'],
    ['Гофра', 'corrugated'],
    ['Гофрированная труба', 'corrugated'],
    ['Труба ПВХ', 'pipe'],
    ['труба гофрированная', 'corrugated'],
    ['Кабель-канал', 'trunking'],
    ['кабельный канал 60×40', 'trunking'],
    ['Короб', 'trunking'],
    ['Стояк', null],
    ['', null],
    ['   ', null],
  ];
  for (const [value, expected] of cases) assert.equal(routeKindOf(value), expected, `тип «${value}»`);
  assert.equal(routeKindPreset('Труба')?.id, 'pipe');
  assert.equal(routeKindPreset('Стояк'), null);
});

test('цвет по умолчанию зависит от типа, свои типы — нейтральный', () => {
  assert.equal(defaultRouteColor('Лоток'), '#008e94');
  assert.equal(defaultRouteColor('лоток'), '#008e94');
  assert.equal(defaultRouteColor('Гофра'), '#e78c22');
  assert.equal(defaultRouteColor('Труба'), '#2f6fda');
  assert.equal(defaultRouteColor('Кабель-канал'), '#2f9e63');
  assert.equal(defaultRouteColor('Стояк'), ROUTE_DEFAULT_COLOR);
  assert.equal(defaultRouteColor(''), ROUTE_DEFAULT_COLOR);
});

test('нормализация цвета трассы: #rgb, #rrggbb и мусор', () => {
  assert.equal(normalizeRouteColor('#ABC'), '#aabbcc');
  assert.equal(normalizeRouteColor(' #AABBCC '), '#aabbcc');
  assert.equal(normalizeRouteColor('#0f0'), '#00ff00');
  for (const value of ['red', '#12', '#12345', 'rgb(1,2,3)', '', null, undefined, 42, {}, []]) {
    assert.equal(normalizeRouteColor(value), null, `значение ${String(value)}`);
  }
});

test('цвет трассы: сохранённый валидный приоритетнее, мусор — цвет по типу', () => {
  assert.equal(routeColor(route({ type: 'Лоток' })), '#008e94');
  assert.equal(routeColor(route({ type: 'Гофра' })), '#e78c22');
  assert.equal(routeColor(route({ type: 'Труба', color: '#AABBCC' })), '#aabbcc');
  assert.equal(routeColor(route({ type: 'Труба', color: 'мусор' })), '#2f6fda');
  assert.equal(routeColor(route({ type: 'Свой тип', color: null })), ROUTE_DEFAULT_COLOR);
});

test('круглые КНС: гофра и труба считаются по диаметру, остальные — прямоугольник', () => {
  assert.equal(isDiameterRoute(route({ type: 'Гофра' })), true);
  assert.equal(isDiameterRoute(route({ type: 'Труба ПВХ' })), true);
  assert.equal(isDiameterRoute(route({ type: 'Лоток' })), false);
  assert.equal(isDiameterRoute(route({ type: 'Кабель-канал' })), false);
  assert.equal(isDiameterRoute(route({ type: 'Стояк' })), false);
});

test('обозначение сечения КНС: площадь, диаметр, Ш×В или прочерк', () => {
  assert.equal(routeSectionLabel(route({ trayAreaMm2: 5000, trayWidthMm: 100 })), 'S=5000 мм²');
  assert.equal(routeSectionLabel(route({ type: 'Гофра', trayWidthMm: 20 })), 'Ø20');
  assert.equal(routeSectionLabel(route({ type: 'Труба', trayHeightMm: 40 })), '—');
  assert.equal(routeSectionLabel(route({ trayWidthMm: 100, trayHeightMm: 50 })), '100×50');
  assert.equal(routeSectionLabel(route({ trayWidthMm: -1, trayHeightMm: 50 })), '—');
  assert.equal(routeSectionLabel(route()), '—');
});

test('миграции: цвет трассы нормализуется, а мусор не подменяется', () => {
  const project = (color: unknown): unknown => ({
    schemaVersion: 2, id: 'p', name: 'Цвет трассы', updatedAt: '2026-01-01T00:00:00Z',
    floors: [{ id: 'f1', name: 'Этаж', elevation: 0, metersPerUnit: 1, page: 1, width: 100, height: 100 }],
    equipment: [], cables: [], pins: [],
    routes: [{ id: 'r1', number: 'Т1', type: 'Гофра', note: '', color, segments: [] }],
  });
  assert.equal(migrateProject(project('#ABC')).routes[0].color, '#aabbcc');
  assert.equal(migrateProject(project('  #AABBCC ')).routes[0].color, '#aabbcc');
  for (const garbage of ['red', '#12', '', 42, {}, null]) {
    const migrated: Project = migrateProject(project(garbage));
    assert.equal(migrated.routes[0].color, undefined, `мусор ${String(garbage)} становится undefined`);
  }
});
