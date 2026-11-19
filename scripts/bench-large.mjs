#!/usr/bin/env node
/**
 * Бенчмарк крупного проекта (2000 сегментов, 200 кабелей).
 *
 * Синтетический проект: 20 трасс по 100 ортогональных сегментов, 400 устройств
 * на концах кабельных цепочек, 200 кабелей по 10 сегментов. Все данные валидны:
 * этаж с масштабом и отметкой, конечные координаты/высоты, цепочки по порядку.
 *
 * Метрики (median/p95 за 20 прогонов, мс):
 *   clone            — полный cloneValue(project) (src/compat);
 *   calcAll          — calculateCable для всех 200 кабелей;
 *   trayFill         — trayFill(project);
 *   totalsLegacy     — текущий totals-цикл с повторным calculateCable;
 *   totalsIndexed    — totals из готовой Map id → CableCalculation;
 *   frameBefore      — кадр «до»: clone + calcAll + trayFill + totalsLegacy;
 *   frameAfterTyping — кадр ввода «после»: shallow-копия + calcAll + trayFill + totalsIndexed;
 *   dragFrameAfter   — кадр перетаскивания «после»: shallow-копия и мутация на месте.
 *
 * Запуск: npx tsx scripts/bench-large.mjs
 * Переменные окружения: BENCH_RUNS (по умолчанию 20), BENCH_WARMUP (3).
 */
import { cloneValue } from '../src/compat.ts';
import { calculateCable, trayFill } from '../src/engine.ts';

const RUNS = Number(process.env.BENCH_RUNS ?? 20);
const WARMUP = Number(process.env.BENCH_WARMUP ?? 3);

function makeProject() {
  const floor = {
    id: 'f1', name: 'Этаж 1', elevation: 0, metersPerUnit: 0.01, page: 1,
    width: 6000, height: 6000,
  };
  const routes = [];
  const cables = [];
  const equipment = [];
  let equipmentIndex = 0;

  for (let r = 0; r < 20; r += 1) {
    const segments = [];
    let vertex = { id: `v-${r}-0`, floorId: floor.id, x: 50 * r, y: 0, height: 2.5 };
    for (let i = 0; i < 100; i += 1) {
      const next = i % 2 === 0
        ? { id: `v-${r}-${i + 1}`, floorId: floor.id, x: vertex.x + 50, y: vertex.y, height: 2.5 }
        : { id: `v-${r}-${i + 1}`, floorId: floor.id, x: vertex.x, y: vertex.y + 50, height: 2.5 };
      segments.push({
        id: `s-${r}-${i}`, a: vertex, b: next, mode: 'orthogonal',
        reservePercent: 0, reserveFixed: 0,
      });
      vertex = next;
    }
    routes.push({
      id: `r-${r}`, number: `T${r + 1}`, type: 'Лоток', note: '', segments,
      trayWidthMm: 100, trayHeightMm: 50,
    });

    // Десять кабелей на трассу: каждый проходит 10 подряд идущих сегментов.
    for (let k = 0; k < 10; k += 1) {
      const chain = segments.slice(k * 10, k * 10 + 10);
      const start = chain[0].a;
      const end = chain[chain.length - 1].b;
      const fromId = `e-${equipmentIndex}`;
      equipment.push({
        id: fromId, number: `E${equipmentIndex + 1}`, name: 'Устройство', type: 'Камера',
        floorId: floor.id, x: start.x, y: start.y, height: start.height,
        note: '', properties: {},
      });
      equipmentIndex += 1;
      const toId = `e-${equipmentIndex}`;
      equipment.push({
        id: toId, number: `E${equipmentIndex + 1}`, name: 'Устройство', type: 'Камера',
        floorId: floor.id, x: end.x, y: end.y, height: end.height,
        note: '', properties: {},
      });
      equipmentIndex += 1;
      cables.push({
        id: `c-${r}-${k}`, number: `K${cables.length + 1}`, name: 'Линия', brand: 'КВК-П',
        purpose: '', fromId, toId, segmentIds: chain.map(segment => segment.id),
        reservePercent: 5, reserveFixed: 0, startReserve: 0.5, endReserve: 0.5,
        quantity: 1, note: '', pricePerMeter: 120, outerDiameterMm: 6,
      });
    }
  }

  return {
    schemaVersion: 2, id: 'bench-large', name: 'Бенчмарк 2000 сегментов',
    updatedAt: '2026-01-01T00:00:00.000Z',
    floors: [floor], equipment, routes, cables, pins: [],
  };
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = value => {
    const position = (sorted.length - 1) * value;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  };
  const median = percentile(0.5);
  const p95 = percentile(0.95);
  return {
    median,
    p95,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function measure(fn) {
  for (let i = 0; i < WARMUP; i += 1) fn();
  const samples = [];
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    fn();
    samples.push(performance.now() - started);
  }
  return stats(samples);
}

const ms = value => (value < 10 ? value.toFixed(2) : value.toFixed(1));

const project = makeProject();
const segmentCount = project.routes.reduce((sum, route) => sum + route.segments.length, 0);
const knownFill = trayFill(project);
let cableMeters = 0;
let badCables = 0;
for (const cable of project.cables) {
  const calculation = calculateCable(project, cable);
  if (calculation.total === null) badCables += 1;
  else cableMeters += calculation.total;
}

// Готовая карта расчётов — то, что хук держит в cableCalcs.
const calcs = new Map(project.cables.map(cable => [cable.id, calculateCable(project, cable)]));

function calcAll() {
  let total = 0;
  for (const cable of project.cables) total += calculateCable(project, cable).total ?? 0;
  return total;
}

function totalsLegacy() {
  let meters = 0;
  let cost = 0;
  for (const cable of project.cables) {
    const calculation = calculateCable(project, cable);
    if (calculation.total !== null) meters += calculation.total * cable.quantity;
    if (calculation.cost !== null) cost += calculation.cost;
  }
  return meters + cost;
}

function totalsIndexed() {
  let meters = 0;
  let cost = 0;
  for (const cable of project.cables) {
    const calculation = calcs.get(cable.id);
    if (!calculation) continue;
    if (calculation.total !== null) meters += calculation.total * cable.quantity;
    if (calculation.cost !== null) cost += calculation.cost;
  }
  return meters + cost;
}

function frameBefore() {
  const next = cloneValue(project);
  let total = 0;
  for (const cable of next.cables) total += calculateCable(next, cable).total ?? 0;
  total += trayFill(next).segments.length;
  for (const cable of next.cables) {
    const calculation = calculateCable(next, cable);
    if (calculation.total !== null) total += calculation.total * cable.quantity;
  }
  return total;
}

function frameAfterTyping() {
  const next = { ...project };
  let total = 0;
  for (const cable of next.cables) total += calculateCable(next, cable).total ?? 0;
  total += trayFill(next).segments.length;
  for (const cable of next.cables) {
    const calculation = calcs.get(cable.id);
    if (calculation?.total !== null && calculation?.total !== undefined) total += calculation.total * cable.quantity;
  }
  return total;
}

function dragFrameAfter() {
  const next = { ...project };
  const item = next.equipment[0];
  const x = item.x;
  const y = item.y;
  item.x = x + 0.1;
  item.y = y + 0.1;
  item.x = x;
  item.y = y;
  return next;
}

const results = {
  clone: measure(() => cloneValue(project)),
  calcAll: measure(calcAll),
  trayFill: measure(() => trayFill(project)),
  totalsLegacy: measure(totalsLegacy),
  totalsIndexed: measure(totalsIndexed),
  frameBefore: measure(frameBefore),
  frameAfterTyping: measure(frameAfterTyping),
  dragFrameAfter: measure(dragFrameAfter),
};

console.log(`AnOOPlan bench-large: ${segmentCount} сегментов, ${project.cables.length} кабелей, ${project.equipment.length} устройств, ${project.routes.length} трасс`);
console.log(`Прогонов: ${RUNS}, прогрев: ${WARMUP}. trayFill: ${knownFill.segments.length} сегментов, ${knownFill.warnings.length} предупреждений, max ${knownFill.maxFillPercent?.toFixed(1) ?? '—'} %`);
console.log(`Проверка данных: ${badCables === 0 ? 'OK' : `ошибок в ${badCables} кабелях`}, суммарно ${cableMeters.toFixed(1)} м`);
console.log('');
console.log('| метрика | median, мс | p95, мс | min, мс | max, мс |');
console.log('|---|---:|---:|---:|---:|');
for (const [name, result] of Object.entries(results)) {
  console.log(`| ${name} | ${ms(result.median)} | ${ms(result.p95)} | ${ms(result.min)} | ${ms(result.max)} |`);
}
