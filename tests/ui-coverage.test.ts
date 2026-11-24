import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { Window } from 'happy-dom';
import type { Project } from '../src/model';
import { EstimateScreen } from '../src/ui/estimate-screen';
import { areaLabel, areaMm2Text, FILL_STATUS_LABELS, fillPercentText, fillStatus, money, number, polygonArea, trayFillText } from '../src/ui/format';
import { blobToBase64, bytesToBase64, nativeBridge, saveBlobOnDevice, vibrate } from '../src/ui/native';
import { baseProject, cable, device, floor, priceItem, route, segment, vertex } from './fixtures';

/**
 * Покрытие экранных модулей сметы: чистые помощники формата, нативный мост
 * и живой экран сметы в happy-dom. Серверный рендер проверяет только разметку
 * и не исполняет обработчики, поэтому основные сценарии (режим работ, редактор
 * справочника, импорт/экспорт) прогоняются через смонтированный React.
 */

/** Неразрывные/узкие пробелы локали → обычные: иначе строку не сравнить с эталоном. */
const plain = (value: string): string => value.replace(/[\u00a0\u202f]/g, ' ');

function setupDom(): Window {
  const window = new Window({ url: 'http://localhost/' });
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    File: window.File,
    Blob: window.Blob,
    FileReader: window.FileReader,
  });
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  return window;
}

type Mounted = {
  window: Window;
  container: HTMLElement;
  messages: string[];
  errors: string[];
  project: () => Project;
  act: (work: () => void | Promise<void>) => Promise<void>;
  unmount: () => Promise<void>;
};

/** Смонтировать экран сметы с управляемым проектом: onChange применяет рецепт к копии. */
async function mountScreen(initial: Project): Promise<Mounted> {
  const window = setupDom();
  // react-dom/client грузим только после появления window/document: иначе React
  // решает, что DOM нет, и не вешает onChange на поле ввода (в happy-dom).
  const { createRoot } = await import('react-dom/client');
  const messages: string[] = [];
  const errors: string[] = [];
  let current = initial;
  function Harness() {
    const [project, setProject] = React.useState<Project>(initial);
    current = project;
    const onChange = (recipe: (draft: Project) => void): void => {
      setProject(previous => {
        const next = structuredClone(previous);
        recipe(next);
        return next;
      });
    };
    return React.createElement(EstimateScreen, {
      project,
      onChange,
      onMessage: (text: string) => { messages.push(text); },
      onError: (text: string) => { errors.push(text); },
    });
  }
  const container = window.document.createElement('div') as unknown as Parameters<typeof createRoot>[0];
  window.document.body.appendChild(container as unknown as Parameters<typeof window.document.body.appendChild>[0]);
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(Harness)); });
  return {
    window,
    container: container as unknown as HTMLElement,
    messages,
    errors,
    project: () => current,
    act: async work => { await React.act(async () => { await work(); }); },
    unmount: async () => {
      await React.act(async () => { root.unmount(); });
      window.close();
    },
  };
}

function byLabel<T extends Element>(mounted: Mounted, label: string): T {
  const found = Array.from(mounted.container.querySelectorAll('[aria-label]'))
    .find(element => element.getAttribute('aria-label') === label);
  assert.ok(found, `не найден элемент с aria-label «${label}»`);
  return found as unknown as T;
}

function buttonByText(mounted: Mounted, text: string): HTMLButtonElement {
  const found = Array.from(mounted.container.querySelectorAll('button'))
    .find(button => (button.textContent ?? '').includes(text));
  assert.ok(found, `не найдена кнопка «${text}»`);
  return found as unknown as HTMLButtonElement;
}

/** Ввод в текстовое/числовое поле через нативный сеттер: React-трекер значения не глотает событие. */
function setInput(mounted: Mounted, element: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(mounted.window.HTMLInputElement.prototype, 'value')?.set;
  return mounted.act(() => {
    if (setter) setter.call(element, value); else element.value = value;
    // 'input' — текстовые поля React; 'change' нужен полям даты/файла в happy-dom.
    element.dispatchEvent(new mounted.window.Event('input', { bubbles: true }) as unknown as Event);
    element.dispatchEvent(new mounted.window.Event('change', { bubbles: true }) as unknown as Event);
  });
}

function setSelect(mounted: Mounted, element: HTMLSelectElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(mounted.window.HTMLSelectElement.prototype, 'value')?.set;
  return mounted.act(() => {
    if (setter) setter.call(element, value); else element.value = value;
    element.dispatchEvent(new mounted.window.Event('change', { bubbles: true }) as unknown as Event);
  });
}

function click(mounted: Mounted, element: Element): Promise<void> {
  return mounted.act(() => { (element as unknown as HTMLElement).click(); });
}

function chooseFile(mounted: Mounted, input: HTMLInputElement, file: File): Promise<void> {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  return mounted.act(() => { input.dispatchEvent(new mounted.window.Event('change', { bubbles: true }) as unknown as Event); });
}

async function waitFor(mounted: Mounted, check: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (check()) return;
    await mounted.act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  assert.fail(`не дождались: ${description}`);
}

/** Проект с полным справочником: материалы 15 300, работы 25 % = 3 825, итог 19 125. */
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

// ——— src/ui/format.ts ———

test('format: number/money — русская локаль, дроби, null/NaN как «—»', () => {
  assert.equal(plain(number(1234.5)), '1 234,5');
  assert.equal(plain(number(1.23456)), '1,235', 'количества — до трёх знаков');
  assert.equal(plain(number(-2000)), '-2 000');
  assert.equal(number(0), '0');
  assert.equal(number(null), '—');
  assert.equal(number(undefined), '—');
  assert.equal(number(Number.NaN), '—');
  assert.equal(number(Number.POSITIVE_INFINITY), '—');
  assert.equal(number('12'), '—', 'строка — не число');

  assert.equal(plain(money(28783.675)), '28 783,68', 'рубли — до копейки');
  assert.equal(plain(money(19125)), '19 125');
  assert.equal(plain(money(1.5)), '1,5');
  assert.equal(money(null), '—');
  assert.equal(money(undefined), '—');
  assert.equal(money(Number.NaN), '—');
  assert.equal(money(Number.NEGATIVE_INFINITY), '—');
  assert.equal(money({}), '—');
});

test('format: статусы заполнения, проценты, площадь', () => {
  assert.deepEqual(FILL_STATUS_LABELS, {
    ok: 'ок', warning: 'внимание', over: 'превышено', empty: 'пусто', incomplete: 'неполный',
  });
  assert.equal(fillStatus('ok'), 'ок');
  assert.equal(fillStatus('incomplete'), 'неполный');
  assert.equal(fillStatus('custom'), 'custom', 'неизвестный статус проходит как есть');
  assert.equal(fillStatus(null), '');
  assert.equal(fillStatus(undefined), '');
  assert.equal(fillStatus(''), '');

  assert.equal(plain(fillPercentText(12.5)), '12,5 %');
  assert.equal(fillPercentText(null), 'не рассчитано');
  assert.equal(fillPercentText(undefined), 'не рассчитано');
  assert.equal(fillPercentText(Number.NaN), 'не рассчитано');

  assert.equal(plain(trayFillText(40, 'warning')), '40 % · внимание');
  assert.equal(plain(trayFillText(40)), '40 %', 'без статуса — только процент');
  assert.equal(trayFillText(40, null), '40 %');
  assert.equal(trayFillText(null, 'ok'), 'не рассчитано');
  assert.equal(trayFillText(Number.NaN, 'ok'), 'не рассчитано');

  assert.equal(plain(areaMm2Text(1234.5)), '1 234,5 мм²');
  assert.equal(areaMm2Text(null), 'не рассчитано');
  assert.equal(areaMm2Text(Number.NaN), 'не рассчитано');
});

test('format: площадь многоугольника и подпись метры/единицы', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(polygonArea(square), 100);
  assert.equal(polygonArea([...square].reverse()), 100, 'направление обхода не важно');
  assert.equal(polygonArea([{ x: 5, y: 5 }]), 0);
  assert.equal(polygonArea([]), 0);
  assert.equal(plain(areaLabel(square, 0.1)), '1 м²');
  assert.equal(plain(areaLabel(square, null)), '100 ед.²');
  assert.equal(plain(areaLabel(square, 0)), '100 ед.²', 'нулевой масштаб — единицы плана');
  assert.equal(plain(areaLabel(square, Number.NaN)), '100 ед.²');
});

// ——— src/ui/native.ts ———

test('native: blobToBase64 и bytesToBase64 (включая большой буфер)', async () => {
  const window = setupDom();
  try {
    const blob = new window.Blob(['hello'], { type: 'text/plain' }) as unknown as Blob;
    assert.equal(await blobToBase64(blob), 'aGVsbG8=');
    assert.equal(bytesToBase64(new Uint8Array([])), '');
    assert.equal(bytesToBase64(new TextEncoder().encode('abc')), 'YWJj');
    const big = new Uint8Array(0x4000 + 5).fill(65);
    assert.equal(bytesToBase64(big).length, Math.ceil(big.length / 3) * 4, 'больше одного чанка');
  } finally {
    window.close();
  }
});

test('native: мост есть/нет, saveBlobOnDevice и vibrate', async () => {
  const window = setupDom();
  const host = window as unknown as { AnOOPlanNative?: Record<string, unknown> };
  try {
    assert.equal(nativeBridge(), null, 'без window.AnOOPlanNative моста нет');
    const smallBlob = (): Blob => new window.Blob(['abc']) as unknown as Blob;
    assert.equal(await saveBlobOnDevice('x.txt', smallBlob()), null, 'без моста — null, качает браузер');
    vibrate();
    vibrate(50);

    const calls: Array<{ name: string; base64: string; mime: string }> = [];
    host.AnOOPlanNative = {
      platform: () => 'android',
      saveFile: (name: string, base64: string, mime: string) => { calls.push({ name, base64, mime }); return 'ok:/sdcard/AnOOPlan/x.txt'; },
      vibrate: (milliseconds: number) => { calls.push({ name: 'vibrate', base64: String(milliseconds), mime: '' }); },
    };
    assert.equal(nativeBridge()?.platform?.(), 'android');
    assert.equal(await saveBlobOnDevice('x.txt', new window.Blob(['abc'], { type: 'text/plain' }) as unknown as Blob), '/sdcard/AnOOPlan/x.txt');
    assert.deepEqual(calls[0], { name: 'x.txt', base64: 'YWJj', mime: 'text/plain' });
    assert.equal(calls[0].base64, 'YWJj');
    vibrate();
    assert.deepEqual(calls[1], { name: 'vibrate', base64: '12', mime: '' }, 'по умолчанию 12 мс');
    vibrate(30);
    assert.deepEqual(calls[2], { name: 'vibrate', base64: '30', mime: '' });

    // Поле без типа — общий MIME.
    await saveBlobOnDevice('raw.bin', smallBlob());
    assert.equal(calls[3].mime, 'application/octet-stream');

    // Мост без saveFile — как отсутствие моста; без vibrate — молча.
    host.AnOOPlanNative = { platform: () => 'android' };
    assert.equal(await saveBlobOnDevice('x.txt', smallBlob()), null);
    vibrate();
  } finally {
    window.close();
  }
});

test('native: saveBlobOnDevice пробрасывает ошибку моста', async () => {
  const window = setupDom();
  const host = window as unknown as { AnOOPlanNative?: Record<string, unknown> };
  try {
    const blob = (): Blob => new window.Blob(['abc']) as unknown as Blob;
    host.AnOOPlanNative = { saveFile: () => 'err: нет свободного места' };
    await assert.rejects(saveBlobOnDevice('x.txt', blob()), /нет свободного места/);
    host.AnOOPlanNative = { saveFile: () => 'err:' };
    await assert.rejects(saveBlobOnDevice('x.txt', blob()), /Не удалось сохранить файл на устройстве/);
  } finally {
    window.close();
  }
});

test('native: blobToBase64 сообщает об ошибке чтения', async () => {
  const window = setupDom();
  const original = globalThis.FileReader;
  let description: string | null = 'нет доступа';
  class FailingReader {
    result: string | null = null;
    error: Error | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(): void {
      queueMicrotask(() => {
        this.error = description === null ? null : new Error(description);
        this.onerror?.();
      });
    }
  }
  globalThis.FileReader = FailingReader as unknown as typeof FileReader;
  try {
    const blob = (): Blob => new window.Blob(['x']) as unknown as Blob;
    await assert.rejects(blobToBase64(blob()), /нет доступа/);
    description = null;
    await assert.rejects(blobToBase64(blob()), /Не удалось прочитать файл/);
  } finally {
    globalThis.FileReader = original;
    window.close();
  }
});

// ——— src/ui/estimate-screen.tsx ———

test('смета: режим работ, правка строк и полей расчёта', async () => {
  const screen = await mountScreen(screenProject());
  try {
    assert.match(plain(screen.container.textContent ?? ''), /работы: 25 % от материалов/);

    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Работы, %'), '40');
    assert.equal(screen.project().estimate?.laborPercent, 40);
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Работы, %'), '');
    assert.equal(screen.project().estimate?.laborPercent, null, 'пустое поле — «не задано», а не 0');
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Работы, %'), '25');

    await setInput(screen, byLabel<HTMLInputElement>(screen, 'НДС, %'), '20');
    assert.equal(screen.project().estimate?.vatRate, 20);
    const included = byLabel<HTMLInputElement>(screen, 'Цены включают НДС');
    await click(screen, included);
    assert.equal(screen.project().estimate?.vatIncluded, true);
    await click(screen, included);
    assert.equal(screen.project().estimate?.vatIncluded, false);
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'НДС, %'), '');
    assert.equal(screen.project().estimate?.vatRate, null);
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'НДС, %'), '20');

    const rounding = byLabel<HTMLSelectElement>(screen, 'Округление');
    await setSelect(screen, rounding, '1');
    assert.equal(screen.project().estimate?.rounding, 1);
    await setSelect(screen, rounding, '');
    assert.equal(screen.project().estimate?.rounding, null, '«без округления» — null');

    const noteInput = screen.container.querySelector<HTMLInputElement>('.estimate-note-field input');
    assert.ok(noteInput);
    await setInput(screen, noteInput, 'Цены на 30 дней');
    assert.equal(screen.project().estimate?.note, 'Цены на 30 дней');
    assert.match(plain(screen.container.textContent ?? ''), /Примечание: Цены на 30 дней/);

    await click(screen, byLabel<HTMLInputElement>(screen, 'Режим работ: по видам работ'));
    assert.equal(screen.project().estimate?.works?.length, 1, 'включение режима создаёт пустую строку');
    assert.match(plain(screen.container.textContent ?? ''), /работы по видам: 1 строка/);
    assert.equal(byLabel<HTMLInputElement>(screen, 'Работы, %').disabled, true, 'в режиме по видам процент заблокирован');

    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Наименование работы 1'), 'Монтаж');
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Единица работы 1'), 'м');
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Количество работы 1'), '2');
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Цена работы 1'), '150');
    const work = screen.project().estimate?.works?.[0];
    assert.equal(work?.name, 'Монтаж');
    assert.equal(work?.unit, 'м');
    assert.equal(work?.quantity, 2);
    assert.equal(work?.price, 150);

    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Количество работы 1'), '');
    assert.equal(screen.project().estimate?.works?.[0].quantity, null);
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Цена работы 1'), '');
    assert.equal(screen.project().estimate?.works?.[0].price, null);
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Цена работы 1'), '150');
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Количество работы 1'), '2');

    await click(screen, buttonByText(screen, '＋ Работа'));
    assert.equal(screen.project().estimate?.works?.length, 2);
    await click(screen, byLabel<HTMLButtonElement>(screen, 'Удалить работу 2'));
    assert.equal(screen.project().estimate?.works?.length, 1);
    assert.equal(screen.messages.length, 0);
    assert.equal(screen.errors.length, 0);
  } finally {
    await screen.unmount();
  }
});

test('смета: проект с работами по видам возвращается к проценту удалением строк', async () => {
  const screen = await mountScreen(screenProject(true));
  try {
    assert.match(plain(screen.container.textContent ?? ''), /работы по видам: 1 строка/);
    assert.equal(byLabel<HTMLInputElement>(screen, 'Работы, %').disabled, true);
    // Удаление последней строки — единственный способ вернуться к проценту.
    await click(screen, byLabel<HTMLButtonElement>(screen, 'Удалить работу 1'));
    assert.equal(screen.project().estimate?.works?.length, 0);
    assert.match(plain(screen.container.textContent ?? ''), /работы: 25 % от материалов/);
    assert.equal(byLabel<HTMLInputElement>(screen, 'Работы, %').disabled, false);
  } finally {
    await screen.unmount();
  }
});

test('смета: редактор норм комплектации — добавление, правка, удаление', async () => {
  const screen = await mountScreen(screenProject());
  try {
    await click(screen, buttonByText(screen, '＋ Норма'));
    assert.equal(screen.project().fittings?.length, 1);
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Наименование комплектации 1'), 'Заглушка');
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Единица комплектации 1'), 'шт');
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Норма на 1 м для комплектации 1'), '0,5');
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Цена комплектации 1'), '30');
    const rule = screen.project().fittings?.[0];
    assert.equal(rule?.name, 'Заглушка');
    assert.equal(rule?.perMeter, 0.5);
    assert.equal(rule?.price, 30);
    // Раздел появляется в смете экрана, как только задана хотя бы одна норма.
    assert.match(plain(screen.container.textContent ?? ''), /Комплектация КНС/);
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Норма на 1 м для комплектации 1'), '');
    assert.equal(screen.project().fittings?.[0].perMeter, null, 'пустая норма — «неизвестно», а не 0');
    await click(screen, byLabel<HTMLButtonElement>(screen, 'Удалить комплектацию 1'));
    assert.equal(screen.project().fittings, undefined, 'пустой список норм не хранится');
    assert.equal(screen.errors.length, 0);
  } finally {
    await screen.unmount();
  }
});

test('смета: редактор справочника — дата, правка позиции, добавление и удаление', async () => {
  const project = screenProject();
  project.catalogDate = '2026-01-01';
  const screen = await mountScreen(project);
  try {
    assert.match(plain(screen.container.textContent ?? ''), /Дата прайса: 01\.01\.2026/);
    const date = byLabel<HTMLInputElement>(screen, 'Дата прайса');
    await setInput(screen, date, '');
    assert.equal(screen.project().catalogDate, null, 'пустая дата — null');
    await setInput(screen, date, '2026-02-02');
    assert.equal(screen.project().catalogDate, '2026-02-02');

    await setSelect(screen, byLabel<HTMLSelectElement>(screen, 'Вид позиции 1'), 'cable');
    assert.equal(screen.project().catalog?.[0].kind, 'cable');
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Наименование позиции 1'), 'Провод');
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Артикул позиции 1'), 'ART-1');
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Производитель позиции 1'), 'Завод');
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Серия позиции 1'), 'S1');
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Размер позиции 1'), '3x1,5');
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Единица позиции 1'), 'км');
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Примечание позиции 1'), 'Тест');
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Цена позиции 1'), '123,5');
    const edited = screen.project().catalog?.[0];
    assert.equal(edited?.name, 'Провод');
    assert.equal(edited?.article, 'ART-1');
    assert.equal(edited?.manufacturer, 'Завод');
    assert.equal(edited?.series, 'S1');
    assert.equal(edited?.size, '3x1,5');
    assert.equal(edited?.unit, 'км');
    assert.equal(edited?.note, 'Тест');
    assert.equal(edited?.price, 123.5);
    await setInput(screen, byLabel<HTMLInputElement>(screen, 'Цена позиции 1'), '');
    assert.equal(screen.project().catalog?.[0].price, null);

    await click(screen, buttonByText(screen, '＋ Позиция'));
    assert.equal(screen.project().catalog?.length, 4);
    const added = screen.project().catalog?.[3];
    assert.equal(added?.name, 'Новая позиция');
    await click(screen, byLabel<HTMLButtonElement>(screen, 'Удалить позицию Новая позиция'));
    assert.equal(screen.project().catalog?.length, 3);
    assert.equal(screen.errors.length, 0);
  } finally {
    await screen.unmount();
  }
});

test('смета: импорт JSON-справочника через скрытый input и отмена подтверждения', async () => {
  const screen = await mountScreen(screenProject());
  const confirmations: string[] = [];
  let confirmed = true;
  (screen.window as unknown as { confirm: (message?: string) => boolean }).confirm = (message?: string) => { confirmations.push(message ?? ''); return confirmed; };
  const input = screen.container.querySelector<HTMLInputElement>('.catalog-import-input');
  assert.ok(input);
  // Кнопка только открывает системный диалог выбора файла — проверяем, что не падает.
  await click(screen, buttonByText(screen, 'Импорт JSON'));
  const jsonFile = (value: unknown): File => new screen.window.File([JSON.stringify(value)], 'catalog.json', { type: 'application/json' }) as unknown as File;
  try {
    // Объект с полем catalog и валидной датой.
    await chooseFile(screen, input, jsonFile({ catalog: [{ id: 'i1', kind: 'cable', name: 'Кабель', unit: 'м', price: 12 }], catalogDate: '2026-03-04' }));
    await waitFor(screen, () => screen.project().catalog?.length === 1, 'импорт объекта catalog');
    assert.equal(screen.project().catalog?.[0].name, 'Кабель');
    assert.equal(screen.project().catalogDate, '2026-03-04');
    assert.ok(screen.messages.some(message => message.includes('Справочник цен импортирован: 1 поз.')), screen.messages.join('; '));

    // Массив позиций; невалидная дата не затирает текущую.
    await chooseFile(screen, input, jsonFile([{ id: 'i2', kind: 'tray', name: 'Лоток', unit: 'м', price: 5, catalogDate: '2026-13-40' }]));
    await waitFor(screen, () => screen.project().catalog?.length === 1 && screen.project().catalog?.[0].name === 'Лоток', 'импорт массива');
    assert.equal(screen.project().catalogDate, '2026-03-04', 'дата из файла вне объекта не применяется');

    // Отмена подтверждения — справочник не меняется.
    confirmed = false;
    await chooseFile(screen, input, jsonFile({ catalog: [{ id: 'i3', kind: 'equipment', name: 'Шкаф', unit: 'шт', price: 100 }] }));
    await waitFor(screen, () => confirmations.length === 3, 'вопрос о замене справочника');
    assert.equal(screen.project().catalog?.[0].name, 'Лоток', 'после отмены справочник прежний');
    assert.match(confirmations[2], /Позиций в файле: 1/);
    confirmed = true;

    // Битый JSON и файл не той формы — понятные ошибки, справочник цел.
    await chooseFile(screen, input, new screen.window.File(['{не json'], 'bad.json', { type: 'application/json' }) as unknown as File);
    await waitFor(screen, () => screen.errors.length === 1, 'ошибка разбора JSON');
    assert.match(screen.errors[0], /Не удалось прочитать JSON/);
    await chooseFile(screen, input, jsonFile({ hello: 'world' }));
    await waitFor(screen, () => screen.errors.length === 2, 'ошибка формы файла');
    assert.match(screen.errors[1], /не похож на справочник цен/);
    assert.equal(screen.project().catalog?.[0].name, 'Лоток');

    // Файл, который не читается (например, пропал доступ) — тоже понятная ошибка.
    const unreadable = new screen.window.File(['{}'], 'broken.json', { type: 'application/json' }) as unknown as File;
    Object.defineProperty(unreadable, 'text', { value: () => Promise.reject(new Error('диск недоступен')) });
    await chooseFile(screen, input, unreadable);
    await waitFor(screen, () => screen.errors.length === 3, 'ошибка чтения файла');
    assert.equal(screen.errors[2], 'диск недоступен');
  } finally {
    await screen.unmount();
  }
});

test('смета: экспорт справочника — браузером и через нативный мост', async () => {
  const screen = await mountScreen(screenProject());
  let createdUrls = 0;
  let revokedUrls = 0;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = () => { createdUrls += 1; return 'blob:test'; };
  (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = () => { revokedUrls += 1; };
  try {
    await click(screen, buttonByText(screen, 'Экспорт справочника'));
    assert.equal(createdUrls, 1, 'без моста файл отдаётся браузеру ссылкой');
    assert.deepEqual(screen.messages, ['Справочник цен сформирован.']);
    assert.equal(screen.errors.length, 0);

    // Мост сохраняет на устройство и возвращает путь.
    const saved: Array<{ name: string; mime: string }> = [];
    (screen.window as unknown as { AnOOPlanNative?: unknown }).AnOOPlanNative = {
      saveFile: (name: string, _base64: string, mime: string) => { saved.push({ name, mime }); return 'ok:/sdcard/AnOOPlan/catalog.json'; },
    };
    await click(screen, buttonByText(screen, 'Экспорт справочника'));
    assert.equal(screen.messages.at(-1), 'Справочник цен сохранён: /sdcard/AnOOPlan/catalog.json');
    assert.equal(saved.at(-1)?.mime, 'application/json;charset=utf-8');

    // Ошибка моста доходит до onError.
    (screen.window as unknown as { AnOOPlanNative?: unknown }).AnOOPlanNative = { saveFile: () => 'err: нет места' };
    await click(screen, buttonByText(screen, 'Экспорт справочника'));
    assert.deepEqual(screen.errors, ['нет места']);
    await waitFor(screen, () => revokedUrls === 1, 'отзыв ссылки браузера');
  } finally {
    (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = originalCreate;
    (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = originalRevoke;
    await screen.unmount();
  }
});

test('смета: импорт таблицы CSV — предпросмотр, применение и отмена', async () => {
  const screen = await mountScreen(screenProject());
  const tableInput = screen.container.querySelector<HTMLInputElement>('.catalog-import-table-input');
  assert.ok(tableInput);
  const csv = 'Вид,Наименование,Артикул,Ед.,Цена\nКабель,ВВГ 3x1.5,ART-9,м,40\nШкаф,Шкаф ШР-1,,шт,12000\n';
  const csvFile = new screen.window.File([csv], 'catalog.csv', { type: 'text/csv' }) as unknown as File;
  try {
    await click(screen, buttonByText(screen, 'Импорт XLSX/CSV'));
    await chooseFile(screen, tableInput, csvFile);
    await waitFor(screen, () => screen.container.querySelector('.catalog-preview') !== null, 'предпросмотр таблицы');
    assert.match(plain(screen.container.querySelector('.catalog-preview')?.textContent ?? ''), /2 поз\. · ошибок: 0/);

    await click(screen, buttonByText(screen, 'Импортировать (2)'));
    assert.equal(screen.project().catalog?.length, 5, 'две новые позиции добавлены к трём');
    assert.ok(screen.messages.some(message => message.includes('добавлено 2, обновлено 0')), screen.messages.join('; '));
    assert.equal(screen.container.querySelector('.catalog-preview'), null, 'после применения предпросмотр закрыт');

    // Отмена не меняет справочник.
    await chooseFile(screen, tableInput, csvFile);
    await waitFor(screen, () => screen.container.querySelector('.catalog-preview') !== null, 'повторный предпросмотр');
    await click(screen, buttonByText(screen, 'Отмена'));
    assert.equal(screen.container.querySelector('.catalog-preview'), null);
    assert.equal(screen.project().catalog?.length, 5);

    // Таблица без колонки «Наименование» — ошибка и пустой предпросмотр.
    const badCsv = 'Артикул,Цена\nART-1,10\n';
    await chooseFile(screen, tableInput, new screen.window.File([badCsv], 'bad.csv', { type: 'text/csv' }) as unknown as File);
    await waitFor(screen, () => screen.errors.length === 1, 'ошибка таблицы');
    assert.match(screen.errors[0], /Наименование/);
    assert.equal(buttonByText(screen, 'Импортировать (0)').disabled, true);

    // Нечитаемый файл таблицы — ошибка с префиксом и текстом причины.
    const unreadable = new screen.window.File(['x'], 'broken.csv', { type: 'text/csv' }) as unknown as File;
    Object.defineProperty(unreadable, 'text', { value: () => Promise.reject(new Error('чтение упало')) });
    await chooseFile(screen, tableInput, unreadable);
    await waitFor(screen, () => screen.errors.length === 2, 'ошибка чтения таблицы');
    assert.equal(screen.errors[1], 'Не удалось прочитать таблицу: чтение упало');
  } finally {
    await screen.unmount();
  }
});

test('смета: неполный проект — предупреждения, пустые разделы и «не рассчитано»', async () => {
  // Без справочника цен нет ни материалов, ни работ: экран объясняет, чего не хватает.
  const project = baseProject({
    name: 'Пустой',
    equipment: [],
    cables: [],
    routes: [],
    catalog: [],
    estimate: { laborPercent: null, note: '', vatRate: 0 },
  });
  const empty = await mountScreen(project);
  try {
    const text = plain(empty.container.textContent ?? '');
    assert.match(text, /Смета неполная/);
    assert.match(text, /Дата прайса: не задана/);
    assert.match(text, /работы: процент не задан/);
    assert.match(text, /Позиций нет\./);
    assert.match(text, /не рассчитано/);
    assert.match(text, /Работы не рассчитаны: не задан процент\./);
    assert.ok(empty.container.querySelectorAll('.estimate-warnings li').length > 0, 'причины неполноты перечислены');
  } finally {
    await empty.unmount();
  }

  // Проект с процентом, но без цен: раздел работ не рассчитан, есть подсказка.
  const percentOnly = baseProject({
    catalog: [priceItem('e1', { name: 'Д-1', price: null })],
    estimate: { laborPercent: 20 },
  });
  const screen = await mountScreen(percentOnly);
  try {
    assert.match(plain(screen.container.textContent ?? ''), /Стоимость работ не рассчитана/);
  } finally {
    await screen.unmount();
  }
});
