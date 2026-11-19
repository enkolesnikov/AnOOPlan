import { test, expect, type Page } from '@playwright/test';

/**
 * 2.9.1 · Замер ввода и перетаскивания на проекте 2000 сегментов / 200 кабелей.
 *
 * Что меряем (production preview, настоящий Chromium, как у пользователя):
 *   • drag  — перетаскивание вершины трассы на плане, 50 шагов указателя;
 *   • input — ввод 10 символов в поле «Название проекта».
 *
 * Чем меряем:
 *   • интервалы между кадрами rAF, собранные только внутри окна жеста
 *     (флаг start/stop: rAF идёт и в покое, его нельзя мерить без окна);
 *   • PerformanceObserver('longtask') — задачи > 50 мс и суммарное блокирование;
 *   • PerformanceObserver('event', durationThreshold 16) — какие именно события
 *     (pointermove/input/keydown) стоят дольше кадра.
 *
 * Критерий отчёта — 16 мс/кадр (60 Гц). Тест падает только на грубом регрессе:
 * p95 > 50 мс. 16 мс печатается в таблице как ориентир, но не как порог:
 * среда CI шумная, и смысл замера — воспроизводимая цифра, а не зелёная галочка.
 *
 * Проект синтетический и валидный: 200 трасс по 10 ортогональных сегментов
 * (сетка 10×20 на одном этаже), 400 устройств на концах цепочек, 200 кабелей.
 */

const FLOOR = { id: 'f1', name: 'Этаж 1', elevation: 0, metersPerUnit: 0.01, page: 1, width: 6000, height: 6000 } as const;
const ROUTES = 200;
const SEGMENTS_PER_ROUTE = 10;
const SEGMENT_UNITS = 50;
const COLS = 10;
const STEP_X = 590;
const STEP_Y = 292;

function buildBenchProject() {
  const equipment: unknown[] = [];
  const routes: unknown[] = [];
  const cables: unknown[] = [];
  let equipmentSeq = 0;

  for (let r = 0; r < ROUTES; r += 1) {
    const x0 = 60 + (r % COLS) * STEP_X;
    const y0 = 60 + Math.floor(r / COLS) * STEP_Y;
    // Змейка: 4 сегмента вправо, вниз, 4 влево, вниз — 10 сегментов, 11 вершин.
    const points: { x: number; y: number }[] = [{ x: x0, y: y0 }];
    for (let i = 1; i <= 4; i += 1) points.push({ x: x0 + i * SEGMENT_UNITS, y: y0 });
    points.push({ x: x0 + 4 * SEGMENT_UNITS, y: y0 + SEGMENT_UNITS });
    for (let i = 1; i <= 4; i += 1) points.push({ x: x0 + 4 * SEGMENT_UNITS - i * SEGMENT_UNITS, y: y0 + SEGMENT_UNITS });
    points.push({ x: x0, y: y0 + 2 * SEGMENT_UNITS });

    const vertex = (x: number, y: number, index: number) => ({ id: `v-${r}-${index}`, floorId: FLOOR.id, x, y, height: 2.5 });
    const segments = [];
    for (let i = 0; i < SEGMENTS_PER_ROUTE; i += 1) {
      segments.push({
        id: `s-${r}-${i}`,
        a: vertex(points[i].x, points[i].y, i),
        b: vertex(points[i + 1].x, points[i + 1].y, i + 1),
        mode: 'orthogonal' as const,
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

const BENCH_PROJECT = buildBenchProject();
const BENCH_PROJECT_JSON = JSON.stringify([BENCH_PROJECT]);

interface Stats {
  count: number;
  median: number;
  p95: number;
  max: number;
}

function stats(values: number[]): Stats {
  if (!values.length) return { count: 0, median: Number.NaN, p95: Number.NaN, max: Number.NaN };
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (q: number) => {
    const position = (sorted.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  };
  return { count: sorted.length, median: percentile(0.5), p95: percentile(0.95), max: sorted[sorted.length - 1] };
}

interface WindowSample {
  frames: number[];
  longtasks: { start: number; dur: number; name: string }[];
  events: { name: string; start: number; duration: number }[];
  t0: number;
  t1: number;
}

interface PhaseResult {
  intervals: number[];
  longTasks: { start: number; dur: number; name: string }[];
  events: { name: string; start: number; duration: number }[];
  blockingMs: number;
  windowMs: number;
}

function summarizeWindow(sample: WindowSample): PhaseResult {
  const intervals: number[] = [];
  if (sample.frames.length && sample.t0) intervals.push(sample.frames[0] - sample.t0);
  for (let i = 1; i < sample.frames.length; i += 1) intervals.push(sample.frames[i] - sample.frames[i - 1]);
  const overlapping = sample.longtasks.filter(task => task.start + task.dur > sample.t0 && task.start < sample.t1);
  const blockingMs = overlapping.reduce((sum, task) => sum + Math.max(0, task.dur - 50), 0);
  return {
    intervals,
    longTasks: overlapping,
    events: sample.events.filter(event => event.start >= sample.t0 && event.start < sample.t1),
    blockingMs,
    windowMs: sample.t1 - sample.t0,
  };
}

/** rAF-петля и наблюдатели; окно замера включается/выключается флагом on. */
async function installProbes(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    if (w.__perf) return;
    const perf = {
      on: false,
      frames: [] as number[],
      longtasks: [] as { start: number; dur: number; name: string }[],
      events: [] as { name: string; start: number; duration: number }[],
      t0: 0,
      start() {
        this.frames = [];
        this.longtasks = [];
        this.events = [];
        this.t0 = performance.now();
        this.on = true;
      },
      stop(): Promise<{ frames: number[]; longtasks: { start: number; dur: number; name: string }[]; events: { name: string; start: number; duration: number }[]; t0: number; t1: number }> {
        const self = this;
        return new Promise(resolve => {
          // Два кадра после жеста: последняя работа попадает в окно, а не в следующий замер.
          requestAnimationFrame(() => requestAnimationFrame(() => {
            self.on = false;
            resolve({
              frames: self.frames.slice(),
              longtasks: self.longtasks.slice(),
              events: self.events.slice(),
              t0: self.t0,
              t1: performance.now(),
            });
          }));
        });
      },
    };
    w.__perf = perf;
    const loop = (time: number) => {
      if (perf.on) perf.frames.push(time);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          perf.longtasks.push({ start: entry.startTime, dur: entry.duration, name: entry.name });
        }
      }).observe({ type: 'longtask', buffered: false });
    } catch { /* движок без longtask */ }
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          perf.events.push({ name: entry.name, start: entry.startTime, duration: entry.duration });
        }
      }).observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit);
    } catch { /* движок без Event Timing */ }
  });
}

/** Задержка «нажатие символа → кадр с новым значением» внутри страницы. */
async function installTypingProbe(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    if (w.__typingInstalled) return;
    w.__typingInstalled = true;
    w.__typing = [];
    const input = document.querySelector('input[aria-label="Название проекта"]');
    input?.addEventListener('keydown', (event: Event) => {
      const key = (event as KeyboardEvent).key;
      if (!w.__typingOn || !key || key.length !== 1) return;
      const t0 = performance.now();
      requestAnimationFrame(() => { (w.__typing as number[]).push(performance.now() - t0); });
    });
  });
}

/**
 * Видимый сегмент, в центр которого реально попадает указатель.
 * Подписи оборудования лежат над линиями, поэтому «первый сегмент» может
 * оказаться накрыт текстом; берём первый, у которого elementFromPoint даёт сегмент.
 */
async function pickSegment(page: Page) {
  const target = await page.evaluate(() => {
    for (const segment of document.querySelectorAll('[data-object="segment"]')) {
      const line = segment.querySelector('line');
      if (!line) continue;
      const box = line.getBoundingClientRect();
      if (Math.max(box.width, box.height) < 8) continue;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit.closest('[data-object="segment"]') === segment) {
        return { x, y, id: segment.getAttribute('data-id') };
      }
    }
    return null;
  });
  if (!target) throw new Error('На экране нет видимого сегмента трассы');
  return target;
}

/** Индекс вершины выбранной трассы, ближайшей к точке и целиком видимой. */
async function pickVertexIndex(page: Page, near: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const circles = [...document.querySelectorAll('circle[data-object="vertex"]')];
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    circles.forEach((circle, index) => {
      const box = circle.getBoundingClientRect();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      if (box.width < 4) return;
      if (cx < 20 || cy < 20 || cx > window.innerWidth - 20 || cy > window.innerHeight - 20) return;
      const distance = Math.hypot(cx - x, cy - y);
      if (distance < bestDistance) { bestDistance = distance; best = index; }
    });
    return best;
  }, near);
}

async function openBenchProject(page: Page) {
  await page.goto('/');
  // Браузерный режим: без /api приложение переходит на localStorage (иначе «Открыть» зовёт сервер).
  await expect(page.locator('.statusbar')).toContainText('БРАУЗЕР', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Открыть', exact: true }).click();
  await expect(page.locator('.modal')).toBeVisible();
  await page.locator('.project-option', { hasText: 'Бенчмарк 2.9.1' }).click();
  await expect(page.locator('.modal')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('[data-object="segment"]')).toHaveCount(ROUTES * SEGMENTS_PER_ROUTE, { timeout: 60_000 });
  await expect(page.locator('.statusbar')).toContainText('400 оборуд. · 200 трасс · 200 кабелей', { timeout: 30_000 });
  await installProbes(page);
}

async function runDrag(page: Page) {
  // Выбор трассы: клик по видимому сегменту (у линии 26px невидимая зона захвата).
  const target = await pickSegment(page);
  await page.mouse.click(target.x, target.y);
  const vertices = page.locator('circle[data-object="vertex"]');
  await expect(vertices.first()).toBeVisible({ timeout: 10_000 });

  // Берём вершину рядом с кликом, но не под подписью оборудования.
  const index = await pickVertexIndex(page, target);
  if (index < 0) throw new Error('Не найдена видимая вершина выбранной трассы');
  const handle = vertices.nth(index);
  const box = await handle.boundingBox();
  if (!box) throw new Error('Вершина трассы не имеет размеров на экране');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const before = await handle.evaluate(node => (node as SVGCircleElement).getAttribute('cx'));

  await page.mouse.move(cx, cy);
  await page.evaluate(() => (window as unknown as { __perf: { start(): void } }).__perf.start());
  await page.mouse.down();
  const STEPS = 50;
  const dx = 40;
  const dy = 20;
  for (let i = 1; i <= STEPS; i += 1) {
    await page.mouse.move(cx + (dx * i) / STEPS, cy + (dy * i) / STEPS);
    // Каждые два шага ждём кадр: pointermove не должен слипнуться в один кадр,
    // иначе «50 шагов» превратятся в 2 кадра и замер потеряет смысл.
    if (i % 2 === 0) {
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    }
  }
  await page.mouse.up();
  const sample = await page.evaluate(() => (window as unknown as { __perf: { stop(): Promise<WindowSample> } }).__perf.stop()) as WindowSample;
  const after = await handle.evaluate(node => (node as SVGCircleElement).getAttribute('cx'));
  return { ...summarizeWindow(sample), moved: before !== after };
}

async function runTyping(page: Page) {
  const input = page.getByLabel('Название проекта');
  await input.click();
  await page.keyboard.press('End');
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__typing = [];
    w.__typingOn = true;
    (w.__perf as { start(): void }).start();
  });
  // 10 символов; 30 мс между ними — человек так не печатает, но кадры успевают
  // пройти между нажатиями, поэтому виден вклад каждого символа, а не очередь.
  await page.keyboard.type('Bench-2.9!', { delay: 30 });
  const typing = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__typingOn = false;
    return (w.__typing as number[]).slice();
  });
  const sample = await page.evaluate(() => (window as unknown as { __perf: { stop(): Promise<WindowSample> } }).__perf.stop()) as WindowSample;
  return { ...summarizeWindow(sample), perSymbol: typing };
}

function printTable(rows: string[][], headers: string[]) {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map(row => (row[index] ?? '').length)));
  const line = (cells: string[]) => cells.map((cell, index) => cell.padEnd(widths[index])).join(' │ ');
  console.log('');
  console.log(line(headers));
  console.log(widths.map(width => '─'.repeat(width)).join('─┼─'));
  for (const row of rows) console.log(line(row));
  console.log('');
}

const ms = (value: number) => (Number.isFinite(value) ? value.toFixed(1) : '—');

test('перф: 2000 сегментов / 200 кабелей — drag и ввод в Chromium', async ({ page }, testInfo) => {
  test.slow();
  console.log(`\nПроект: ${ROUTES} трасс × ${SEGMENTS_PER_ROUTE} сегм. = ${ROUTES * SEGMENTS_PER_ROUTE} сегментов, ` +
    `${BENCH_PROJECT.equipment.length} устройств, ${BENCH_PROJECT.cables.length} кабелей; ` +
    `этаж ${FLOOR.width}×${FLOOR.height} ед., масштаб ${FLOOR.metersPerUnit} м/ед.`);

  await page.addInitScript((payload: string) => {
    localStorage.setItem('cableplan:projects', payload);
    localStorage.removeItem('cableplan:autosave');
  }, BENCH_PROJECT_JSON);

  const environment = await (async () => {
    await page.goto('/');
    return page.evaluate(() => ({
      userAgent: navigator.userAgent,
      cores: navigator.hardwareConcurrency,
      deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
      longtask: PerformanceObserver.supportedEntryTypes.includes('longtask'),
      eventTiming: PerformanceObserver.supportedEntryTypes.includes('event'),
    }));
  })();
  console.log(`Среда: ${environment.userAgent}`);
  console.log(`Ядра: ${environment.cores}, память: ${environment.deviceMemory ?? '—'} ГБ, ` +
    `longtask: ${environment.longtask ? 'да' : 'нет'}, event timing: ${environment.eventTiming ? 'да' : 'нет'}`);

  let footprint: { bytes: number; serializeMedianMs: number; nodes: number } | null = null;

  const REPS = 3;
  const dragRuns: { stats: Stats; blocking: number; longTasks: number; events: number; windowMs: number; moved: boolean }[] = [];
  const typingRuns: { stats: Stats; symbol: Stats; blocking: number; longTasks: number; windowMs: number }[] = [];
  const dragEventLog: { name: string; duration: number }[] = [];
  const typingEventLog: { name: string; duration: number }[] = [];
  const allLongTasks: { dur: number; name: string }[] = [];

  for (let rep = 1; rep <= REPS; rep += 1) {
    await openBenchProject(page);
    if (!footprint) {
      footprint = await page.evaluate((payload: string) => {
        const project = JSON.parse(payload);
        const samples: number[] = [];
        for (let i = 0; i < 5; i += 1) {
          const started = performance.now();
          JSON.stringify(project);
          samples.push(performance.now() - started);
        }
        samples.sort((a, b) => a - b);
        return {
          bytes: payload.length,
          serializeMedianMs: samples[Math.floor(samples.length / 2)],
          nodes: document.querySelectorAll('*').length,
        };
      }, BENCH_PROJECT_JSON);
      console.log(`Проект: ${(footprint.bytes / 1024).toFixed(0)} КБ JSON, ${footprint.nodes} DOM-узлов; ` +
        `полная сериализация проекта в этой вкладке: ${ms(footprint.serializeMedianMs)} мс — ` +
        'столько же раз на каждое изменение считает проверка dirty (JSON.stringify в use-workspace-state).');
    }
    const drag = await runDrag(page);
    const dragStats = stats(drag.intervals);
    dragRuns.push({
      stats: dragStats,
      blocking: drag.blockingMs,
      longTasks: drag.longTasks.length,
      events: drag.events.length,
      windowMs: drag.windowMs,
      moved: drag.moved,
    });
    dragEventLog.push(...drag.events.map(event => ({ name: event.name, duration: event.duration })));
    allLongTasks.push(...drag.longTasks.map(task => ({ dur: task.dur, name: task.name })));

    // Автосохранение после drag (1500 мс дебаунса) не должно попасть в окно ввода.
    await page.waitForTimeout(2200);

    await installTypingProbe(page);
    const typing = await runTyping(page);
    const typingStats = stats(typing.intervals);
    typingRuns.push({
      stats: typingStats,
      symbol: stats(typing.perSymbol),
      blocking: typing.blockingMs,
      longTasks: typing.longTasks.length,
      windowMs: typing.windowMs,
    });
    allLongTasks.push(...typing.longTasks.map(task => ({ dur: task.dur, name: task.name })));
    typingEventLog.push(...typing.events.map(event => ({ name: event.name, duration: event.duration })));

    console.log(`Прогон ${rep}/${REPS}: drag median ${ms(dragStats.median)} мс, p95 ${ms(dragStats.p95)} мс, ` +
      `${drag.intervals.length} кадров, ${drag.longTasks.length} long tasks, блокирование ${ms(drag.blockingMs)} мс; ` +
      `ввод median ${ms(typingStats.median)} мс, p95 ${ms(typingStats.p95)} мс, ` +
      `символ p95 ${ms(typing.perSymbol.length ? stats(typing.perSymbol).p95 : Number.NaN)} мс`);
    if (!drag.moved) console.log('  ВНИМАНИЕ: вершина не сдвинулась — замер drag недостоверен.');
  }

  // Сводка по трём прогонам: медиана медиан и медиана p95 — устойчивее одного прогона.
  const aggregate = (runs: { stats: Stats }[]) => ({
    median: stats(runs.map(run => run.stats.median)).median,
    p95: stats(runs.map(run => run.stats.p95)).median,
    max: Math.max(...runs.map(run => run.stats.max)),
    frames: runs.reduce((sum, run) => sum + run.stats.count, 0),
  });
  const dragAgg = aggregate(dragRuns);
  const typingAgg = aggregate(typingRuns);
  const symbolAgg = stats(typingRuns.flatMap(run => (run.symbol.count ? [run.symbol.median] : [])));

  printTable([
    ['drag (50 шагов)', ms(dragAgg.median), ms(dragAgg.p95), ms(dragAgg.max), String(dragAgg.frames),
      String(dragRuns.reduce((sum, run) => sum + run.longTasks, 0)), ms(dragRuns.reduce((sum, run) => sum + run.blocking, 0))],
    ['ввод (10 символов)', ms(typingAgg.median), ms(typingAgg.p95), ms(typingAgg.max), String(typingAgg.frames),
      String(typingRuns.reduce((sum, run) => sum + run.longTasks, 0)), ms(typingRuns.reduce((sum, run) => sum + run.blocking, 0))],
  ], ['сценарий', 'median, мс', 'p95, мс', 'max, мс', 'кадров', 'long tasks', 'блокирование, мс']);

  printTable(
    typingRuns.map((run, index) => [`прогон ${index + 1}`, ms(run.symbol.median), ms(run.symbol.p95), ms(run.symbol.max), String(run.symbol.count)]),
    ['ввод: символ → кадр', 'median, мс', 'p95, мс', 'max, мс', 'замеров'],
  );

  console.log(`Ориентир 60 Гц: 16.7 мс/кадр. Итог: drag p95 ${ms(dragAgg.p95)} мс, ввод p95 ${ms(typingAgg.p95)} мс; ` +
    `медиана символа ${ms(symbolAgg.median)} мс.`);

  const slowestEvents = [...dragEventLog].sort((a, b) => b.duration - a.duration).slice(0, 8);
  if (slowestEvents.length) {
    console.log('Долгие события drag (Event Timing, > 16 мс): ' +
      slowestEvents.map(event => `${event.name} ${event.duration.toFixed(1)} мс`).join(', '));
  }
  const slowestTyping = [...typingEventLog].sort((a, b) => b.duration - a.duration).slice(0, 8);
  if (slowestTyping.length) {
    console.log('Долгие события ввода (Event Timing, > 16 мс): ' +
      slowestTyping.map(event => `${event.name} ${event.duration.toFixed(1)} мс`).join(', '));
  }
  const slowTasks = [...allLongTasks].sort((a, b) => b.dur - a.dur).slice(0, 5);
  if (slowTasks.length) {
    console.log('Самые долгие главные задачи: ' + slowTasks.map(task => `${task.dur.toFixed(0)} мс (${task.name})`).join(', '));
  }

  await testInfo.attach('perf-2000.json', {
    body: JSON.stringify({ environment, footprint, drag: dragRuns, typing: typingRuns, aggregate: { drag: dragAgg, typing: typingAgg, symbol: symbolAgg } }, null, 2),
    contentType: 'application/json',
  });

  // Грубый регресс — это когда кадр перестаёт укладываться в 50 мс, а не 16:
  // на общей машине фоновые процессы дают одиночные выбросы, и 16 мс — цель, не гейт.
  expect(dragRuns.every(run => run.moved), 'вершина должна сдвинуться в каждом прогоне').toBe(true);
  expect(dragAgg.frames, 'кадров drag достаточно для статистики').toBeGreaterThan(REPS * 10);
  expect(dragAgg.p95).toBeLessThanOrEqual(50);
  expect(typingAgg.p95).toBeLessThanOrEqual(50);
});
