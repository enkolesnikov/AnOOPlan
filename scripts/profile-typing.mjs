// Разовый профилировщик: что занимает кадр при вводе в «Название проекта»
// на бенчмарк-проекте 2000 сегментов. Запуск: node scripts/profile-typing.mjs
// (нужен поднятый preview: npm run build && npm run preview -- --port 4173)
import { chromium } from '@playwright/test';

const FLOOR = { id: 'f1', name: 'Этаж 1', elevation: 0, metersPerUnit: 0.01, page: 1, width: 6000, height: 6000 };
const ROUTES = 200, SEGMENTS_PER_ROUTE = 10, SEGMENT_UNITS = 50, COLS = 10, STEP_X = 590, STEP_Y = 292;

function buildBenchProject() {
  const equipment = [];
  const routes = [];
  const cables = [];
  let equipmentSeq = 0;

  for (let r = 0; r < ROUTES; r += 1) {
    const x0 = 60 + (r % COLS) * STEP_X;
    const y0 = 60 + Math.floor(r / COLS) * STEP_Y;
    // Змейка: 4 сегмента вправо, вниз, 4 влево, вниз — 10 сегментов, 11 вершин.
    const points = [{ x: x0, y: y0 }];
    for (let i = 1; i <= 4; i += 1) points.push({ x: x0 + i * SEGMENT_UNITS, y: y0 });
    points.push({ x: x0 + 4 * SEGMENT_UNITS, y: y0 + SEGMENT_UNITS });
    for (let i = 1; i <= 4; i += 1) points.push({ x: x0 + 4 * SEGMENT_UNITS - i * SEGMENT_UNITS, y: y0 + SEGMENT_UNITS });
    points.push({ x: x0, y: y0 + 2 * SEGMENT_UNITS });

    const vertex = (x, y, index) => ({ id: `v-${r}-${index}`, floorId: FLOOR.id, x, y, height: 2.5 });
    const segments = [];
    for (let i = 0; i < SEGMENTS_PER_ROUTE; i += 1) {
      segments.push({
        id: `s-${r}-${i}`,
        a: vertex(points[i].x, points[i].y, i),
        b: vertex(points[i + 1].x, points[i + 1].y, i + 1),
        mode: 'orthogonal',
        reservePercent: 0,
        reserveFixed: 0,
      });
    }
    routes.push({
      id: `r-${r}`, number: `T${r + 1}`, type: 'Лоток', note: '', segments,
      trayWidthMm: 100, trayHeightMm: 50,
    });

    const start = points[0];
    const end = points[points.length - 1];
    const fromId = `e-${equipmentSeq}`;
    equipment.push({
      id: fromId, number: `E${equipmentSeq + 1}`, name: 'Устройство', type: 'Камера',
      floorId: FLOOR.id, x: start.x, y: start.y, height: 2.5, note: '', properties: {},
    });
    equipmentSeq += 1;
    const toId = `e-${equipmentSeq}`;
    equipment.push({
      id: toId, number: `E${equipmentSeq + 1}`, name: 'Устройство', type: 'Камера',
      floorId: FLOOR.id, x: end.x, y: end.y, height: 2.5, note: '', properties: {},
    });
    equipmentSeq += 1;

    cables.push({
      id: `c-${r}`, number: `K${r + 1}`, name: 'Линия', brand: 'КВК-П', purpose: '',
      fromId, toId, segmentIds: segments.map(segment => segment.id),
      reservePercent: 5, reserveFixed: 0, startReserve: 0.5, endReserve: 0.5,
      quantity: 1, note: '', pricePerMeter: 120, outerDiameterMm: 6,
    });
  }

  return {
    schemaVersion: 2,
    id: 'bench-2000',
    name: 'Бенчмарк 2.9.1 · 2000 сегментов',
    updatedAt: '2026-01-01T00:00:00.000Z',
    floors: [FLOOR],
    equipment,
    routes,
    cables,
    pins: [],
  };
}


const BENCH_PROJECT_JSON = JSON.stringify([buildBenchProject()]);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(payload => {
  localStorage.setItem('cableplan:projects', payload);
  localStorage.removeItem('cableplan:autosave');
}, BENCH_PROJECT_JSON);
await page.goto('http://127.0.0.1:4173/');
await page.waitForSelector('.statusbar', { timeout: 30000 });
await page.getByRole('button', { name: 'Открыть', exact: true }).click();
await page.locator('.project-option', { hasText: 'Бенчмарк 2.9.1' }).click();
await page.waitForSelector('[data-object="segment"]', { state: 'attached', timeout: 60000 });

const client = await page.context().newCDPSession(page);
await client.send('Profiler.enable');
await client.send('Profiler.setSamplingInterval', { interval: 100 });
await client.send('Profiler.start');
const input = page.getByLabel('Название проекта');
await input.click();
await page.keyboard.press('End');
await page.keyboard.type('Bench-2.9!', { delay: 30 });
const { profile } = await client.send('Profiler.stop');
await browser.close();

// Агрегируем self-time по функциям.
const nodes = new Map(profile.nodes.map(nd => [nd.id, nd]));
const self = new Map();
for (const s of profile.samples ?? []) {
  const nd = nodes.get(s);
  if (!nd) continue;
  const f = nd.callFrame;
  const key = `${f.functionName || '(anon)'} @ ${f.url.split('/').pop()}:${f.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + 1);
}
const total = (profile.samples ?? []).length;
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log(`Сэмплов всего: ${total} (~${total / 10} мс CPU)`);
for (const [key, count] of top) console.log(`${String(count).padStart(5)}  ${(count / 10).toFixed(0).padStart(5)} мс  ${key}`);
