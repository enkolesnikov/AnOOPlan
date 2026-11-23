import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoProject, demoPlanPdf, isStaleDemoProject, refreshedDemoProject } from '../src/demo';
import { domainWarnings, validateProject } from '../src/engine';
import { estimate } from '../src/estimate';
import type { PriceItem } from '../src/model';

const catalogItem = (catalog: PriceItem[], kind: PriceItem['kind'], name: string): PriceItem | undefined =>
  catalog.find(item => item.kind === kind && item.name.trim().toLowerCase() === name.trim().toLowerCase());

test('демо-проект: валиден и смета полная, без предупреждений', () => {
  const demo = createDemoProject();
  assert.deepEqual(validateProject(demo), []);

  const result = estimate(demo);
  assert.equal(result.complete, true);
  assert.deepEqual(result.warnings, []);
  assert.notEqual(result.materials, null);
  assert.notEqual(result.labor, null);
  assert.notEqual(result.total, null);
  assert.notEqual(result.vat, null);
  assert.notEqual(result.gross, null);
});

test('демо-проект: проверки проекта проходят без замечаний', () => {
  const demo = createDemoProject();
  assert.deepEqual(validateProject(demo), []);
  // Цены кабелей, сечения КНС и кабелей, заполнение лотков — всё на месте.
  assert.deepEqual(domainWarnings(demo), []);
});

test('устаревший учебный проект: распознаётся и заменяется свежим', () => {
  const fresh = createDemoProject();
  assert.equal(isStaleDemoProject(fresh), false);
  assert.equal(refreshedDemoProject(fresh), null);

  // Копия, сохранённая старой версией приложения: ни цен, ни сечений.
  const stale = createDemoProject();
  for (const cable of stale.cables) delete cable.pricePerMeter;
  for (const route of stale.routes) { delete route.trayWidthMm; delete route.trayHeightMm; }
  assert.ok(domainWarnings(stale).length > 0, 'у устаревшей копии должны быть замечания');
  assert.equal(isStaleDemoProject(stale), true);

  const healed = refreshedDemoProject(stale);
  assert.ok(healed, 'устаревшая учебная копия должна заменяться свежей');
  assert.deepEqual(validateProject(healed), []);
  assert.deepEqual(domainWarnings(healed), []);

  // Рабочий проект с теми же пробелами, но другим названием, не трогаем.
  stale.name = 'Объект заказчика';
  assert.equal(isStaleDemoProject(stale), false);
  assert.equal(refreshedDemoProject(stale), null);
});

test('демо-проект: 8–10 единиц оборудования, 4–6 кабелей, 4–5 трасс и 2–3 замечания', () => {
  const demo = createDemoProject();
  assert.ok(demo.equipment.length >= 8 && demo.equipment.length <= 10, `оборудования: ${demo.equipment.length}`);
  assert.ok(demo.cables.length >= 4 && demo.cables.length <= 6, `кабелей: ${demo.cables.length}`);
  assert.ok(demo.routes.length >= 4 && demo.routes.length <= 5, `трасс: ${demo.routes.length}`);
  assert.ok(demo.pins.length >= 2 && demo.pins.length <= 3, `замечаний: ${demo.pins.length}`);
});

test('демо-проект: у этажей разные страницы одной двухстраничной подложки', () => {
  const demo = createDemoProject();
  const [first, second] = demo.floors;
  assert.ok(first.pdfId, 'у первого этажа нет PDF');
  assert.equal(second.pdfId, first.pdfId, 'этажи должны ссылаться на один документ');
  assert.equal(first.page, 1);
  assert.equal(second.page, 2);
  assert.notEqual(first.page, second.page);
});

test('демо-PDF: две страницы, без латинских подписей и текста', () => {
  const data = demoPlanPdf();
  assert.ok(data.startsWith('data:application/pdf;base64,'));
  const pdf = atob(data.slice(data.indexOf(',') + 1));
  assert.match(pdf, /\/Count\s+2\b/, 'в PDF должно быть две страницы');
  const pages = pdf.match(/\/Type\s*\/Page\b/g) ?? [];
  assert.equal(pages.length, 2, 'объектов страниц должно быть два');
  assert.ok(!pdf.includes('CABLEPLAN'), 'в подложке осталось латинское название продукта');
  assert.ok(!pdf.includes('Helvetica'), 'в подложке остался стандартный шрифт');
  assert.ok(!pdf.includes('/Font'), 'в подложке не должно быть шрифтов: текст печатает приложение');
});

test('демо-проект: у каждой модели оборудования есть цена в справочнике', () => {
  const demo = createDemoProject();
  const catalog = demo.catalog ?? [];
  for (const item of demo.equipment) {
    const model = item.properties.model;
    assert.ok(model, `${item.number}: не задана модель`);
    assert.notEqual(model, item.name, `${item.number}: модель не должна повторять наименование`);
    const price = catalogItem(catalog, 'equipment', model);
    assert.ok(price, `${item.number}: модели «${model}» нет в справочнике`);
    assert.notEqual(price.price, null, `${item.number}: у модели «${model}» нет цены`);
  }
});

test('демо-проект: у каждой трассы задана подсистема, и их не одна', () => {
  const demo = createDemoProject();
  assert.ok(demo.routes.every(route => route.subsystem), 'у трассы не задана подсистема');
  assert.ok(new Set(demo.routes.map(route => route.subsystem)).size >= 2, 'КНС не группируется по подсистемам');
});

test('демо-проект: все позиции справочника задействованы, запас трасс не нулевой', () => {
  const demo = createDemoProject();
  const catalog = demo.catalog ?? [];
  for (const item of catalog) {
    const used = item.kind === 'equipment'
      ? demo.equipment.some(entry => entry.properties.model.trim().toLowerCase() === item.name.trim().toLowerCase())
      : item.kind === 'cable'
        ? demo.cables.some(cable => cable.brand.trim().toLowerCase() === item.name.trim().toLowerCase())
        : demo.routes.some(route => route.type.trim().toLowerCase() === item.name.trim().toLowerCase());
    assert.ok(used, `позиция справочника «${item.name}» не используется`);
  }
  for (const route of demo.routes) {
    assert.ok(route.segments.every(segment => segment.reservePercent > 0), `у трассы ${route.number} нет запаса`);
  }
});

test('демо-проект: марки кабелей с десятичной запятой и второй маркой СКС', () => {
  const demo = createDemoProject();
  const brands = demo.cables.map(cable => cable.brand);
  assert.ok(brands.includes('КВК-П 2×0,75'), 'нет марки КВК-П с запятой');
  assert.ok(brands.includes('UTP cat.5e'), 'нет второй марки для розетки');
  assert.ok(!brands.some(brand => brand.includes('2×0.75')), 'осталась точка вместо запятой');
});

test('демо-проект: смета с НДС 20 % и округлением до рубля', () => {
  const demo = createDemoProject();
  const result = estimate(demo);
  assert.equal(result.vatRate, 20);
  assert.equal(result.vatIncluded, false);
  assert.equal(result.rounding, 1);
  assert.equal(result.materials, 136532);
  assert.equal(result.labor, 34133);
  assert.equal(result.total, 170665);
  assert.equal(result.vat, 34133);
  assert.equal(result.gross, 204798);
  for (const value of [result.materials, result.labor, result.total, result.vat, result.gross]) {
    assert.notEqual(value, null);
    assert.ok(Number.isInteger(value), `${value} не целые рубли`);
  }
});
