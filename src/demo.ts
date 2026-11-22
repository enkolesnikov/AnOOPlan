import type { Project, Floor, Equipment, Route, Cable, Segment, Vertex, Pin, PriceItem, PriceKind } from './model';
import { createUuid } from './compat';

/** Идентификаторы демо-проекта уникальны и не используют слабый Math.random. */
const uid = (): string => `demo-${createUuid()}`;

const floor = (id: string, name: string, elevation: number, page: number): Floor => ({
  id, name, elevation, metersPerUnit: 0.05, page, width: 1000, height: 700,
});

const vertex = (id: string, floorId: string, x: number, y: number, height = 2.5): Vertex => ({ id, floorId, x, y, height });

/**
 * Запас трассы — 5 %: в журнале колонка «Запас трасс» должна быть заполнена,
 * иначе демо выглядит как черновик без расчёта запасов на поворотах.
 */
const segment = (id: string, a: Vertex, b: Vertex): Segment =>
  ({ id, a, b, mode: 'orthogonal', reservePercent: 5, reserveFixed: 0 });

/**
 * Оборудование: `name` — человекочитаемое место («Камера входа»), `model` — реальная
 * модель/артикул. Смета ищет цену по `properties.model`, поэтому в справочнике
 * позиции названы моделями, а не местами установки.
 */
const equipment = (
  id: string, number: string, name: string, type: string,
  floorId: string, x: number, y: number, height: number, model: string, note = '',
): Equipment => ({ id, number, name, type, floorId, x, y, height, note, properties: { model } });

const DEMO_CATALOG_DATE = '2026-10-01';
const DEMO_KVK_PRICE_PER_METER = 38;
const DEMO_UTP_PRICE_PER_METER = 24;

/** Позиция учебного справочника цен; id — через uid(), чтобы демо-копии не конфликтовали. */
const priceItem = (kind: PriceKind, name: string, price: number, unit = 'шт', details: Partial<PriceItem> = {}): PriceItem =>
  ({ id: uid(), kind, name, unit, price, note: '', ...details });

const cable = (
  id: string, number: string, name: string, brand: string, purpose: string,
  fromId: string, toId: string, segmentIds: string[], pricePerMeter: number,
  quantity = 1, outerDiameterMm = 6,
): Cable => ({
  id, number, name, brand, purpose, fromId, toId, segmentIds,
  reservePercent: 10, reserveFixed: 0, startReserve: 0.5, endReserve: 0.5,
  quantity, note: '', outerDiameterMm, pricePerMeter,
});

const PDF_WIDTH = 1000;
const PDF_HEIGHT = 700;

/** Векторные операции PDF: только линии, рамки и условные обозначения, без текста. */
type Ops = string[];

const rect = (ops: Ops, x: number, y: number, w: number, h: number): void => {
  ops.push(`${x} ${y} ${w} ${h} re S`);
};
const line = (ops: Ops, x1: number, y1: number, x2: number, y2: number): void => {
  ops.push(`${x1} ${y1} m ${x2} ${y2} l S`);
};

/** Условное обозначение лестницы: марш из ступеней внутри прямоугольника. */
function stairs(ops: Ops, x: number, y: number, w: number, h: number, verticalTreads: boolean): void {
  rect(ops, x, y, w, h);
  const steps = 7;
  for (let index = 1; index < steps; index += 1) {
    if (verticalTreads) {
      const stepX = x + (w * index) / steps;
      line(ops, stepX, y, stepX, y + h);
    } else {
      const stepY = y + (h * index) / steps;
      line(ops, x, stepY, x + w, stepY);
    }
  }
}

/** Условное обозначение стоякового отсека: шахта с диагоналями. */
function riserShaft(ops: Ops, x: number, y: number, w: number, h: number): void {
  rect(ops, x, y, w, h);
  line(ops, x, y, x + w, y + h);
  line(ops, x, y + h, x + w, y);
}

/** План первого этажа: коридор по центру, разные комнаты, лестница справа сверху. */
function floorPlanOne(): string {
  const ops: Ops = [];
  ops.push('q 1 w');
  rect(ops, 60, 60, 880, 580);
  // Коридор по центру: вдоль него идёт магистральный лоток.
  line(ops, 60, 300, 940, 300);
  line(ops, 60, 400, 940, 400);
  // Верхние комнаты.
  line(ops, 250, 400, 250, 640);
  line(ops, 450, 400, 450, 640);
  line(ops, 650, 400, 650, 640);
  // Нижние комнаты.
  line(ops, 300, 60, 300, 300);
  line(ops, 600, 60, 600, 300);
  // Дверные проёмы в коридор.
  line(ops, 240, 300, 240, 380);
  line(ops, 440, 300, 440, 380);
  line(ops, 640, 300, 640, 380);
  stairs(ops, 700, 440, 160, 160, true);
  riserShaft(ops, 80, 300, 80, 100);
  ops.push('Q');
  return ops.join('\n');
}

/** План второго этажа: другая сетка комнат, лестница снизу, тот же стояковый отсек. */
function floorPlanTwo(): string {
  const ops: Ops = [];
  ops.push('q 1 w');
  rect(ops, 60, 60, 880, 580);
  // Коридор той же высоты, но комнаты нарезаны иначе — планировка не копирует первый этаж.
  line(ops, 60, 300, 940, 300);
  line(ops, 60, 400, 940, 400);
  // Верхние комнаты: две широкие.
  line(ops, 350, 400, 350, 640);
  line(ops, 550, 400, 550, 640);
  // Нижние комнаты: три.
  line(ops, 200, 60, 200, 300);
  line(ops, 500, 60, 500, 300);
  line(ops, 800, 60, 800, 300);
  // Дверные проёмы в коридор.
  line(ops, 340, 300, 340, 380);
  line(ops, 540, 300, 540, 380);
  stairs(ops, 520, 80, 160, 160, false);
  riserShaft(ops, 80, 300, 80, 100);
  ops.push('Q');
  return ops.join('\n');
}

/** Собирает многостраничный PDF из потоков контента (без шрифтов и текста). */
function pdfDataUrl(pages: string[]): string {
  const objects: string[] = [
    '<</Type/Catalog/Pages 2 0 R>>',
    `<</Type/Pages/Kids[${pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}]/Count ${pages.length}>>`,
  ];
  pages.forEach((content, index) => {
    objects.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${PDF_WIDTH} ${PDF_HEIGHT}]/Contents ${4 + index * 2} 0 R>>`);
    objects.push(`<</Length ${content.length}>>stream\n${content}\nendstream`);
  });
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new TextEncoder().encode(pdf);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return 'data:application/pdf;base64,' + btoa(binary);
}

/**
 * Демо-подложка: две страницы, по одной на этаж. Подписи «AnOOPlan · Этаж N»
 * печатает приложение своим шрифтом, поэтому в самом PDF текста нет — только
 * планировка, лестница и стояковый отсек.
 */
export function demoPlanPdf(): string {
  return pdfDataUrl([floorPlanOne(), floorPlanTwo()]);
}

/** Учебный синтетический проект для первого знакомства с приложением. */
export function createDemoProject(): Project {
  const plan = demoPlanPdf();
  const f1: Floor = { ...floor(uid(), 'Этаж 1', 0, 1), pdfId: plan };
  // Планировки разные, поэтому каждому этажу — своя страница подложки.
  const f2: Floor = { ...floor(uid(), 'Этаж 2', 4, 2), pdfId: plan };

  const equipmentList: Equipment[] = [
    equipment(uid(), 'Ш1', 'Шкаф питания', 'Шкаф', f1.id, 120, 350, 0, 'TRASSIR TR-1U4', 'Основной шкаф видеонаблюдения.'),
    equipment(uid(), 'К1', 'Камера входа', 'Камера', f1.id, 300, 300, 3, 'TRASSIR TR-D2123IR2'),
    equipment(uid(), 'К2', 'Камера коридора', 'Камера', f1.id, 500, 350, 3, 'TRASSIR TR-D2123IR2'),
    equipment(uid(), 'К3', 'Камера периметра', 'Камера', f1.id, 700, 200, 3, 'TRASSIR TR-D2223IR4'),
    equipment(uid(), 'Р1', 'Розетка у входа', 'Розетка', f1.id, 200, 200, 0.3, 'Hyperline KC-5E-1P', 'Информационная розетка СКС.'),
    equipment(uid(), 'Ш2', 'Шкаф этажа 2', 'Шкаф', f2.id, 120, 350, 0, 'DKC R5-1000', 'Шкаф этажа 2.'),
    equipment(uid(), 'К4', 'Камера лестницы', 'Камера', f2.id, 600, 200, 3, 'TRASSIR TR-D1123IR2'),
    equipment(uid(), 'С1', 'Коммутатор PoE', 'Коммутатор', f1.id, 135, 335, 1.5, 'TRASSIR TR-SW8P', 'Установлен в шкафу Ш1.'),
  ];
  const byNumber = (number: string) => equipmentList.find(item => item.number === number)!;

  // Этаж 1: лоток по коридору, спуск к камере входа гофрой и короткий кабель-канал к розетке.
  const a1 = vertex(uid(), f1.id, 120, 350);
  const b1 = vertex(uid(), f1.id, 300, 350);
  const c1 = vertex(uid(), f1.id, 500, 350);
  const d1 = vertex(uid(), f1.id, 700, 350);
  const e1 = vertex(uid(), f1.id, 700, 200);
  const f1v = vertex(uid(), f1.id, 300, 300);
  const g1 = vertex(uid(), f1.id, 300, 250);
  const h1 = vertex(uid(), f1.id, 200, 250);
  const i1 = vertex(uid(), f1.id, 200, 200);

  // Этаж 2: стояк от шкафа Ш1, лоток по коридору и спуск к камере лестницы.
  const j2 = vertex(uid(), f2.id, 120, 350);
  const k2 = vertex(uid(), f2.id, 600, 350);
  const l2 = vertex(uid(), f2.id, 600, 200);

  const s1 = segment(uid(), a1, b1);
  const s2 = segment(uid(), b1, c1);
  const s3 = segment(uid(), c1, d1);
  const s4 = segment(uid(), d1, e1);
  const s5 = segment(uid(), a1, j2); // межэтажный стояк
  const s6 = segment(uid(), j2, k2);
  const s7 = segment(uid(), k2, l2);
  const s8 = segment(uid(), b1, f1v); // гофра от лотка к камере входа
  const s9 = segment(uid(), b1, g1); // кабель-канал от лотка к розетке
  const s10 = segment(uid(), g1, h1);
  const s11 = segment(uid(), h1, i1);

  const routes: Route[] = [
    {
      id: uid(), number: 'Т1', type: 'Лоток', note: 'Магистральный лоток этажа 1',
      segments: [s1, s2, s3, s4], trayWidthMm: 100, trayHeightMm: 50, subsystem: 'horizontal',
    },
    {
      id: uid(), number: 'Т2', type: 'Стояк', note: 'Межэтажный стояк Ш1–Ш2',
      segments: [s5], trayWidthMm: 50, trayHeightMm: 50, subsystem: 'trunk',
    },
    {
      id: uid(), number: 'Т3', type: 'Лоток', note: 'Лоток этажа 2',
      segments: [s6, s7], trayWidthMm: 100, trayHeightMm: 50, subsystem: 'horizontal',
    },
    {
      id: uid(), number: 'Т4', type: 'Кабель-канал', note: 'Кабель-канал к розетке у входа',
      segments: [s9, s10, s11], trayWidthMm: 25, trayHeightMm: 25, subsystem: 'horizontal',
    },
    {
      id: uid(), number: 'Т5', type: 'Гофра', note: 'Спуск к камере входа',
      segments: [s8], trayWidthMm: 20, subsystem: 'horizontal',
    },
  ];

  const cables: Cable[] = [
    cable(uid(), 'Л1', 'Камера входа', 'КВК-П 2×0,75', 'Видеонаблюдение', byNumber('Ш1').id, byNumber('К1').id, [s1.id, s8.id], DEMO_KVK_PRICE_PER_METER),
    cable(uid(), 'Л2', 'Камера коридора', 'КВК-П 2×0,75', 'Видеонаблюдение', byNumber('Ш1').id, byNumber('К2').id, [s1.id, s2.id], DEMO_KVK_PRICE_PER_METER),
    cable(uid(), 'Л3', 'Камера периметра', 'КВК-П 2×0,75', 'Видеонаблюдение', byNumber('Ш1').id, byNumber('К3').id, [s1.id, s2.id, s3.id, s4.id], DEMO_KVK_PRICE_PER_METER, 2),
    cable(uid(), 'Л4', 'Магистраль Ш1–Ш2', 'UTP cat.5e', 'СКС', byNumber('Ш1').id, byNumber('Ш2').id, [s5.id], DEMO_UTP_PRICE_PER_METER, 1, 5.5),
    cable(uid(), 'Л5', 'Камера лестницы', 'КВК-П 2×0,75', 'Видеонаблюдение', byNumber('Ш2').id, byNumber('К4').id, [s6.id, s7.id], DEMO_KVK_PRICE_PER_METER),
    cable(uid(), 'Л6', 'Розетка у входа', 'UTP cat.5e', 'СКС', byNumber('Ш1').id, byNumber('Р1').id, [s1.id, s9.id, s10.id, s11.id], DEMO_UTP_PRICE_PER_METER, 1, 5.5),
  ];

  const now = new Date().toISOString();
  const pins: Pin[] = [
    { id: uid(), number: 'З-1', floorId: f1.id, x: 300, y: 420, comment: 'Проверить высоту камеры и подвод кабеля.', status: 'open', photos: [], createdAt: now, updatedAt: now },
    { id: uid(), number: 'З-2', floorId: f2.id, x: 600, y: 260, comment: 'Уточнить марку кабеля у заказчика.', status: 'closed', photos: [], createdAt: now, updatedAt: now },
  ];

  return {
    schemaVersion: 2,
    id: uid(),
    name: 'Учебный проект',
    floors: [f1, f2],
    equipment: equipmentList,
    routes,
    cables,
    pins,
    updatedAt: now,
    catalog: [
      priceItem('equipment', 'TRASSIR TR-1U4', 28500),
      priceItem('equipment', 'TRASSIR TR-D2123IR2', 6500),
      priceItem('equipment', 'TRASSIR TR-D2223IR4', 7200),
      priceItem('equipment', 'Hyperline KC-5E-1P', 450),
      priceItem('equipment', 'DKC R5-1000', 24500),
      priceItem('equipment', 'TRASSIR TR-D1123IR2', 6500),
      priceItem('equipment', 'TRASSIR TR-SW8P', 9800),
      priceItem('cable', 'КВК-П 2×0,75', DEMO_KVK_PRICE_PER_METER, 'м'),
      priceItem('cable', 'UTP cat.5e', DEMO_UTP_PRICE_PER_METER, 'м'),
      priceItem('tray', 'Лоток', 480, 'м', { manufacturer: 'DKC', article: '3540', series: 'Лоток перфорированный', size: '100×50' }),
      priceItem('tray', 'Стояк', 620, 'м', { manufacturer: 'DKC', article: '3520', series: 'Лоток перфорированный', size: '50×50' }),
      priceItem('tray', 'Гофра', 95, 'м', { manufacturer: 'IEK', article: 'GF-20', series: 'Гофра ПВХ', size: 'Ø20' }),
      priceItem('tray', 'Кабель-канал', 280, 'м', { manufacturer: 'DKC', article: '0125', series: 'Кабель-канал', size: '25×25' }),
    ],
    catalogDate: DEMO_CATALOG_DATE,
    estimate: {
      laborPercent: 25,
      note: 'Цены действительны 30 дней.',
      vatRate: 20,
      vatIncluded: false,
      rounding: 1,
    },
    document: {
      organization: 'ООО «Проект-Монтаж»',
      object: 'Учебный объект: офис на 2 этажа',
      documentCode: 'АП-2026-01',
      city: 'Екатеринбург',
      title: 'Кабельный журнал и смета',
      compiledBy: 'Инженер А.И. Петров',
      checkedBy: 'ГИП С.В. Смирнов',
      date: '2026-10-15',
      changeLog: [
        { id: uid(), version: '1', date: '2026-10-01', author: 'А.И. Петров', description: 'Первая редакция' },
        { id: uid(), version: '2', date: '2026-10-15', author: 'С.В. Смирнов', description: 'Уточнён справочник цен и смета' },
      ],
    },
  };
}
