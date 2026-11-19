// Аудит 2.9, C-04: углы КНС на трассах со стояком, при обратной записи сегментов
// и на стыке двух трасс одного типа (в том числе после splitRouteAtVertex).
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeAngleStats, routeSummary } from '../src/engine';
import { createDemoProject } from '../src/demo';
import { splitRouteAtVertex } from '../src/plan-edits';
import { baseProject, route, segment, vertex } from './fixtures';

test('угол не теряется, если сегменты записаны в обратном порядке', () => {
  const start = vertex('start', 0, 0);
  const corner = vertex('corner', 100, 0);
  const finish = vertex('finish', 100, 100);
  // Хранимое направление тоже обратное: b -> a.
  const reversed = route('r', [
    segment('s2', finish, corner),
    segment('s1', corner, start),
  ]);
  const stats = routeAngleStats(reversed);
  assert.equal(stats.total, 1);
  assert.equal(stats.angles90, 1);
});

test('Г-образная трасса из двух сегментов даёт один угол', () => {
  const corner = vertex('corner', 100, 0);
  const lShape = route('r', [
    segment('s1', vertex('a', 0, 0), corner),
    segment('s2', corner, vertex('b', 100, 100)),
  ]);
  assert.equal(routeAngleStats(lShape).total, 1);
});

test('межэтажный стояк не рвёт цепочку и не даёт ложного угла', () => {
  const f1Start = vertex('f1-start', 0, 0, 3, 'f1');
  const f1Corner = vertex('f1-corner', 100, 0, 3, 'f1');
  const f2Corner = vertex('f2-corner', 100, 0, 0, 'f2');
  const f2Finish = vertex('f2-finish', 100, 100, 0, 'f2');
  const riser = segment('riser', f1Corner, f2Corner);
  const turnAfterRiser = route('r', [
    segment('h1', f1Start, f1Corner),
    riser,
    segment('h2', f2Corner, f2Finish),
  ]);
  const stats = routeAngleStats(turnAfterRiser);
  assert.equal(stats.total, 1, 'поворот после стояка сохраняется');
  assert.equal(stats.angles90, 1);

  assert.equal(routeAngleStats(route('riser-only', [riser])).total, 0, 'стояк без планарной проекции угла не даёт');

  const straightAfterRiser = route('r-straight', [
    segment('h1', f1Start, f1Corner),
    riser,
    segment('h2', f2Corner, vertex('f2-end', 200, 0, 0, 'f2')),
  ]);
  assert.equal(routeAngleStats(straightAfterRiser).total, 0, 'прямое продолжение после стояка — не угол');
});

test('split: стык двух трасс одного типа считается один раз и без задвоения', () => {
  const corner = vertex('corner', 100, 0);
  const original = route('r1', [
    segment('s1', vertex('a', 0, 0), corner),
    segment('s2', corner, vertex('b', 100, 100)),
  ], { number: 'Т1' });
  assert.equal(routeAngleStats(original).total, 1, 'исходная Г-образная трасса');

  const split = splitRouteAtVertex(original, 'corner', 'r2');
  assert.ok(split, 'split выполняется по внутренней вершине');
  const summary = routeSummary(baseProject({ routes: [split.first, split.second] }));

  const lotok = summary.groups.find(group => group.group === 'Лоток');
  assert.ok(lotok);
  assert.equal(lotok.angles.total, 1, 'итог группы — один угол на стыке, а не ноль и не два');
  const perRoute = summary.routes.map(row => row.angles.total);
  assert.deepEqual(perRoute, [0, 1], 'угол отнесён к трассе, чей сегмент начинается в узле');
  assert.equal(perRoute.reduce((sum, value) => sum + value, 0), 1, 'сумма по трассам равна итогу группы');
});

test('демо: суммарные углы лотков Т1 и Т3 не теряются', () => {
  const summary = routeSummary(createDemoProject());
  const byNumber = new Map(summary.routes.map(row => [row.number, row]));
  assert.equal(byNumber.get('Т1')?.angles.total, 1);
  assert.equal(byNumber.get('Т3')?.angles.total, 1);
  assert.equal(byNumber.get('Т2')?.angles.total, 0, 'одиночный стояк углов не имеет');

  const tray = summary.groups.find(group => group.group === 'Лоток');
  assert.ok(tray);
  assert.equal(tray.routes, 2);
  assert.equal(tray.angles.total, 2);
  assert.equal(
    summary.routes.filter(row => row.group === 'Лоток').reduce((sum, row) => sum + row.angles.total, 0),
    tray.angles.total,
    'сумма углов по трассам совпадает с итогом группы',
  );
});
