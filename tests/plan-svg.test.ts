import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanSvg } from '../src/plan-svg';
import { createDemoProject } from '../src/demo';
import { domainWarnings } from '../src/engine';

test('SVG плана содержит трассы и обозначения оборудования', () => {
  const project = createDemoProject();
  const floor = project.floors[0];
  const svg = buildPlanSvg(project, floor);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes(`viewBox="0 0 ${Math.round(floor.width * 10) / 10} ${Math.round(floor.height * 10) / 10}"`));
  assert.ok(!svg.includes('#ffffff'), 'SVG не должен перекрывать PDF белой заливкой');
  const onFloor = project.equipment.filter(item => item.floorId === floor.id);
  assert.ok(onFloor.length > 0, 'в демо есть оборудование на этаже');
  for (const item of onFloor) assert.ok(svg.includes(`>${item.number}</text>`), `нет подписи ${item.number}`);
  assert.ok(svg.includes('stroke="#008e94"'), 'нет линий трасс');
  assert.ok(svg.includes(`AnOOPlan · ${floor.name}`), 'нет подписи листа');
});

test('SVG экранирует пользовательские названия', () => {
  const project = createDemoProject();
  const floor = project.floors[0];
  project.equipment[0].number = '<E1>';
  const svg = buildPlanSvg(project, floor);
  assert.ok(svg.includes('&lt;E1&gt;'));
  assert.ok(!svg.includes('<E1>'));
});

test('доменные предупреждения: длина витой пары, цена и пустая трасса', () => {
  const project = createDemoProject();
  for (const floor of project.floors) floor.metersPerUnit = 40;
  const cable = project.cables[0];
  cable.brand = 'UTP cat5e';
  const warnings = domainWarnings(project);
  assert.ok(warnings.some(w => w.includes('витая пара длиннее 100 м')), 'нет предупреждения о длине витой пары');
  assert.ok(warnings.some(w => w.includes('не задана цена за метр')), 'нет предупреждения о цене');

  for (const item of project.cables) item.pricePerMeter = 30;
  const priced = domainWarnings(project);
  assert.ok(!priced.some(w => w.includes('не задана цена')), 'цена задана — предупреждения быть не должно');

  project.routes[0].segments = [];
  assert.ok(domainWarnings(project).some(w => w.includes('нет сегментов')));
});

test('SVG плана — прозрачный оверлей для подложки PDF', () => {
  const project = createDemoProject();
  const svg = buildPlanSvg(project, project.floors[0]);
  assert.ok(!svg.includes('fill="#ffffff"'), 'нет белой заливки');
  assert.ok(!svg.includes('<rect width="100%" height="100%"'), 'нет полноразмерного прямоугольника');
});
