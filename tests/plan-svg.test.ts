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

test('SVG плана рисует трассы цветом типа КНС и своим цветом', () => {
  const project = createDemoProject();
  const floor = project.floors[0];
  // Только трассы: у розетки в демо свой оранжевый цвет иконки, он не должен вмешиваться.
  project.equipment = [];
  project.routes[0].type = 'Гофра';
  project.routes[0].color = undefined;
  const orange = buildPlanSvg(project, floor);
  assert.ok(orange.includes('stroke="#e78c22"'), 'гофра должна быть оранжевой');

  project.routes[0].color = '#123456';
  const custom = buildPlanSvg(project, floor);
  assert.ok(custom.includes('stroke="#123456"'), 'свой цвет трассы должен попасть в PDF-план');
  assert.ok(!custom.includes('stroke="#e78c22"'), 'свой цвет вытесняет цвет по умолчанию');
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
  // В учебном проекте цена задана (38 ₽/м), поэтому проверку «цена не задана»
  // делаем на копии без pricePerMeter — сама проверка не ослаблена.
  const project = createDemoProject();
  for (const floor of project.floors) floor.metersPerUnit = 40;
  for (const item of project.cables) delete item.pricePerMeter;
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

  // Демонстрационный проект сразу со стоимостью: у всех кабелей одна цена — 38 ₽/м.
  const demo = createDemoProject();
  assert.ok(demo.cables.every(item => item.pricePerMeter === 38), 'в демо у всех кабелей должна быть цена 38 ₽/м');
  assert.ok(!domainWarnings(demo).some(w => w.includes('не задана цена')), 'у демо цена задана — предупреждения нет');
});

test('SVG плана — прозрачный оверлей для подложки PDF', () => {
  const project = createDemoProject();
  const svg = buildPlanSvg(project, project.floors[0]);
  assert.ok(!svg.includes('fill="#ffffff"'), 'нет белой заливки');
  assert.ok(!svg.includes('<rect width="100%" height="100%"'), 'нет полноразмерного прямоугольника');
});

test('SVG плана этажа 1 рисует оборудование иконками с цветом', () => {
  const project = createDemoProject();
  const floor = project.floors[0];
  const svg = buildPlanSvg(project, floor);
  const onFloor = project.equipment.filter(item => item.floorId === floor.id);
  const types = new Set(onFloor.map(item => item.type));
  assert.ok(types.has('Камера') && types.has('Шкаф') && types.has('Розетка'), 'в демо на этаже 1 нужны камера, шкаф и розетка');

  // Иконки: и камера, и шкаф, и розетка — с разными идентификаторами.
  assert.ok(svg.includes('data-icon="camera"'), 'нет иконки камеры');
  assert.ok(svg.includes('data-icon="cabinet"'), 'нет иконки шкафа');
  assert.ok(svg.includes('data-icon="socket"'), 'нет иконки розетки');
  // Глиф — заливка цветом (шкаф по умолчанию #875ec5), а не тёмный квадрат.
  assert.ok(svg.includes('fill="#875ec5"'), 'нет заливки глифа шкафа цветом по умолчанию');
  assert.ok(svg.includes('stroke="#875ec5"'), 'нет обводки бейджа шкафа');
  assert.ok(svg.includes('fill-rule="evenodd"'), 'контуры должны вырезаться правилом evenodd');

  // Номера по-прежнему подписаны, включая новую розетку.
  for (const item of onFloor) assert.ok(svg.includes(`>${item.number}</text>`), `нет подписи ${item.number}`);
  assert.ok(svg.includes('>Р1</text>'), 'нет подписи новой розетки Р1');

  // Оверлей остаётся прозрачным, название экранируется.
  assert.ok(!svg.includes('#ffffff'), 'иконки не должны заливать лист белым');
  assert.ok(!svg.includes('<rect width="100%" height="100%"'), 'нет полноразмерного белого прямоугольника');
  // Белые заливки допустимы только как маленькие бейджи иконок, а не как лист подложки.
  const whiteRects = [...svg.matchAll(/<rect[^>]*width="(\d+(?:\.\d+)?)"[^>]*height="(\d+(?:\.\d+)?)"/g)]
    .map(match => [Number(match[1]), Number(match[2])]);
  assert.ok(whiteRects.length > 0, 'в SVG нет бейджей иконок');
  assert.ok(whiteRects.every(([width, height]) => width <= 24 && height <= 24), `бейджи должны быть маленькими: ${JSON.stringify(whiteRects)}`);

  // Сохранённый цвет оборудования нормализуется и попадает в заливку.
  const custom = createDemoProject();
  custom.equipment[0].color = '#ABC';
  const customSvg = buildPlanSvg(custom, custom.floors[0]);
  assert.ok(customSvg.includes('fill="#aabbcc"'), 'сохранённый цвет должен краситься в нормализованный #aabbcc');
  assert.ok(!customSvg.includes('fill="#abc"'), 'трёхзначный цвет должен приводиться к #rrggbb');
});


test('SVG плана рисует относительный размер между оборудованием', () => {
  const project = createDemoProject();
  const floor = project.floors[0];
  const onFloor = project.equipment.filter(item => item.floorId === floor.id).slice(0, 2);
  project.dimensions = [{ id: 'd1', fromId: onFloor[0].id, toId: onFloor[1].id }];
  const svg = buildPlanSvg(project, floor);
  assert.ok(svg.includes('stroke="#875ec5"'), 'нет линии размера');
  assert.ok(/\d[\d,.]* (мм|м)/.test(svg), 'нет подписи расстояния');
});
