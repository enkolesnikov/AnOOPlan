import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { nonNegativeOrNull, workLineTotal, workLinesWord } from '../src/ui/estimate-fields';
import { money, number } from '../src/ui/format';
import { EstimateScreen } from '../src/ui/estimate-screen';
import type { Project } from '../src/model';
import { baseProject, cable, device, floor, priceItem, route, segment, vertex } from './fixtures';

/**
 * Экран сметы: чистые помощники (деньги, разбор полей, сумма строки) и серверный
 * рендер — проверяем строку «Итого до НДС», блокировку процента в режиме по видам
 * и отсутствие трёх знаков у рублей. Живое поведение дополнительно проверяет
 * смоук (scripts/smoke-dom.mjs).
 */

/** Неразрывные пробелы локали → обычные: иначе строку не сравнить с эталоном. */
const plain = (value: string): string => value.replace(/\u00a0/g, ' ');

test('пустое и мусорное значение строки работ — null, а не 0', () => {
  assert.equal(nonNegativeOrNull(''), null);
  assert.equal(nonNegativeOrNull('   '), null);
  assert.equal(nonNegativeOrNull('abc'), null);
  assert.equal(nonNegativeOrNull('-3'), null);
  assert.equal(nonNegativeOrNull('0'), 0);
  assert.equal(nonNegativeOrNull('12,5'), 12.5);
  assert.equal(nonNegativeOrNull(' 7 '), 7);
});

test('сумма строки работ: количество × цена с округлением сметы', () => {
  const work = { quantity: 3, price: 100.5 };
  assert.equal(workLineTotal(work, null), 301.5);
  assert.equal(workLineTotal(work, 1), 302);
  assert.equal(workLineTotal(work, 10), 300);
  // Без явного правила деньги точны до копейки — как в estimate(), а не до трёх знаков.
  assert.equal(workLineTotal({ quantity: 1, price: 28.675 }, null), 28.68);
  // Ноль — известное значение, а не «неизвестно»: он остаётся нулём.
  assert.equal(workLineTotal({ quantity: 0, price: 100 }, null), 0);
  assert.equal(workLineTotal({ quantity: null, price: 100 }, null), null);
  assert.equal(workLineTotal({ quantity: 2, price: null }, null), null);
});

test('склонение «строка» по числу', () => {
  assert.equal(workLinesWord(0), 'строк');
  assert.equal(workLinesWord(1), 'строка');
  assert.equal(workLinesWord(2), 'строки');
  assert.equal(workLinesWord(5), 'строк');
  assert.equal(workLinesWord(11), 'строк');
  assert.equal(workLinesWord(21), 'строка');
  assert.equal(workLinesWord(22), 'строки');
  assert.equal(workLinesWord(25), 'строк');
});

test('money: рубли — не больше двух знаков после запятой, количества — до трёх', () => {
  assert.equal(plain(money(28783.675)), '28 783,68');
  assert.equal(plain(money(143918.38)), '143 918,38');
  assert.equal(plain(money(19125)), '19 125');
  assert.equal(plain(money(1.5)), '1,5');
  // Неизвестная сумма — «—», а не 0.
  assert.equal(money(null), '—');
  assert.equal(money(undefined), '—');
  assert.equal(money(Number.NaN), '—');
  // Рубли с тремя знаками — именно тот баг, который чиним.
  assert.doesNotMatch(plain(money(1234.5678)), /,\d{3}/);
  // Количества по-прежнему показываем до трёх знаков — их не «округляем до копейки».
  assert.equal(plain(number(1.23456)), '1,235');
});

/** Проект для рендера: материалы 15 300, работы 25 % = 3 825, итог 19 125. */
function screenProject(items = false): Project {
  return baseProject({
    name: 'Смета',
    floors: [floor('f1', { name: 'Первый' })],
    equipment: [
      device('a', 0, { number: 'A', name: 'Устройство A', properties: { model: 'Д-1' } }),
      device('b', 100, { number: 'B', name: 'Устройство B', properties: { model: 'Д-1' } }),
    ],
    routes: [route('r', [segment('s1', vertex('v1', 0, 0, 1), vertex('v2', 100, 0, 1))])],
    cables: [cable({ id: 'c1', segmentIds: ['s1'], pricePerMeter: 50 })],
    catalog: [
      priceItem('e1', { name: 'Д-1', price: 5000 }),
      priceItem('cb1', { kind: 'cable', name: 'ВВГ', unit: 'м', price: 40 }),
      priceItem('t1', { kind: 'tray', name: 'Лоток', unit: 'м', price: 480 }),
    ],
    estimate: items
      ? { laborPercent: 25, works: [{ id: 'w1', name: 'Настройка', unit: 'шт', quantity: 1, price: 100 }] }
      : { laborPercent: 25 },
  });
}

/** Серверный рендер экрана сметы без DOM: хендлеры без побочных эффектов. */
function renderScreen(project: Project): string {
  return renderToStaticMarkup(createElement(EstimateScreen, {
    project,
    onChange: () => {},
    onMessage: () => {},
    onError: () => {},
  }));
}

test('«Итого до НДС» показывает net и помечено «(без НДС)» при НДС в цене', () => {
  const project = screenProject();
  project.estimate = { laborPercent: 25, vatRate: 20, vatIncluded: true };
  const html = renderScreen(project);
  const subtotal = html.match(/<div class="estimate-subtotal">([\s\S]*?)<\/div>/)?.[1] ?? '';
  const flat = plain(subtotal);

  assert.match(flat, /Итого до НДС/);
  assert.match(flat, /\(без НДС\)/, 'при НДС «в цене» строка помечена как база без налога');
  // total = 19 125 (с налогом), vat = 3 187,5, net = 15 937,5 — показываем net.
  assert.ok(flat.includes('15 937,5 ₽'), `в строке net: ${flat}`);
  assert.ok(!flat.includes('19 125'), 'total с налогом в этой строке не показывается');
});

test('без НДС «в цене» строка «Итого до НДС» не помечается и показывает total', () => {
  const project = screenProject();
  project.estimate = { laborPercent: 25, vatRate: 20 };
  const flat = plain(renderScreen(project).match(/<div class="estimate-subtotal">([\s\S]*?)<\/div>/)?.[1] ?? '');
  assert.ok(!flat.includes('(без НДС)'));
  assert.ok(flat.includes('19 125 ₽'), `в строке total: ${flat}`);
});

test('«Работы, %» заблокировано в режиме по видам и активно в режиме процента', () => {
  const itemsHtml = renderScreen(screenProject(true));
  const itemsInput = itemsHtml.match(/<input[^>]*aria-label="Работы, %"[^>]*>/)?.[0] ?? '';
  assert.ok(itemsInput.includes('disabled'), 'в режиме по видам поле disabled');
  assert.ok(itemsHtml.includes('title="В режиме по видам процент не применяется"'), 'есть подсказка почему');

  const percentHtml = renderScreen(screenProject(false));
  const percentInput = percentHtml.match(/<input[^>]*aria-label="Работы, %"[^>]*>/)?.[0] ?? '';
  assert.ok(percentInput && !percentInput.includes('disabled'), 'в режиме процента поле активно');
});

test('экран сметы не печатает рубли с тремя знаками', () => {
  // 2×50 000 + 10×1 000,5 + 10×512,97 = 115 134,7; работы 25 % = 28 783,675 → 28 783,68.
  const project = screenProject();
  project.equipment = [
    device('a', 0, { number: 'A', name: 'Устройство A', properties: { model: 'Д-1' } }),
    device('b', 100, { number: 'B', name: 'Устройство B', properties: { model: 'Д-1' } }),
  ];
  project.catalog = [
    priceItem('e1', { name: 'Д-1', price: 50000 }),
    priceItem('t1', { kind: 'tray', name: 'Лоток', unit: 'м', price: 512.97 }),
  ];
  project.cables[0].pricePerMeter = 1000.5;
  const html = plain(renderScreen(project));

  assert.ok(html.includes('28 783,68 ₽'), 'работы округлены до копейки');
  assert.ok(html.includes('143 918,38 ₽'), 'итог округлён до копейки');
  assert.doesNotMatch(html, /\d,\d{3}\s*₽/, 'ни у одной суммы в рублях нет третьего знака');
});

