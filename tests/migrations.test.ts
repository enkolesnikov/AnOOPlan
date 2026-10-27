import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_SCHEMA_VERSION, migrateProject, ProjectSchemaError } from '../src/migrations';
import { createDemoProject } from '../src/demo';
import type { Project } from '../src/model';

function project(): Project {
  return {
    schemaVersion: 1, id: 'p1', name: 'Проект', updatedAt: '2026-01-01T00:00:00Z',
    floors: [{ id: 'f1', name: 'Этаж', elevation: 0, metersPerUnit: 0.1, page: 1, width: 1000, height: 700 }],
    equipment: [{ id: 'e1', number: 'E1', name: 'Камера', type: 'Камера', floorId: 'f1', x: 1, y: 2, height: null, note: '', properties: {} }],
    routes: [], cables: [], pins: [],
  };
}

test('валидный проект v1 мигрирует в v2 без потери данных', () => {
  const source = project();
  const migrated = migrateProject(source);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.id, source.id);
  assert.deepEqual(migrated.floors, source.floors);
  assert.deepEqual(migrated.routes, source.routes);
  assert.deepEqual(migrated.cables, source.cables);
  assert.deepEqual(migrated.pins, []);
  assert.deepEqual(migrated.equipment[0], { ...source.equipment[0], photos: [], color: undefined });
  assert.equal(CURRENT_SCHEMA_VERSION, 2);
});

test('проект v2 сохраняет пины и нормализует их поля', () => {
  const source = JSON.parse(JSON.stringify(project())) as Record<string, unknown>;
  source.schemaVersion = 2;
  source.pins = [{ id: 'z1', number: 'З-1', floorId: 'f1', x: 10, y: 20, comment: 'Проверить', status: 'open', photos: ['p1'] }];
  const migrated = migrateProject(source);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.pins.length, 1);
  assert.equal(migrated.pins[0].number, 'З-1');
  assert.equal(migrated.pins[0].status, 'open');
  assert.deepEqual(migrated.pins[0].photos, ['p1']);
  assert.ok(migrated.pins[0].createdAt);
});

test('старый JSON без schemaVersion и photos нормализуется', () => {
  const legacy = JSON.parse(JSON.stringify(project())) as Record<string, unknown>;
  delete legacy.schemaVersion;
  const equipment = (legacy.equipment as Record<string, unknown>[])[0];
  delete equipment.photos;
  equipment.note = undefined;
  const migrated = migrateProject(legacy);
  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.equipment[0].photos, []);
  assert.equal(migrated.equipment[0].note, '');
});

test('проект из будущей версии отклоняется понятной ошибкой', () => {
  const future = { ...project(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
  assert.throws(() => migrateProject(future), (error: unknown) =>
    error instanceof ProjectSchemaError && /более новой версией/.test(error.message));
});

test('повреждённые обязательные списки и идентификатор отклоняются', () => {
  assert.throws(() => migrateProject({ schemaVersion: 1, id: 'p' }), ProjectSchemaError);
  const broken = JSON.parse(JSON.stringify(project())) as Record<string, unknown>;
  broken.floors = 'нет';
  assert.throws(() => migrateProject(broken), /обязательные списки/);
  const noId = JSON.parse(JSON.stringify(project())) as Record<string, unknown>;
  delete noId.id;
  assert.throws(() => migrateProject(noId), /идентификатор/);
});

function rawProject(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(project())) as Record<string, unknown>;
}

function pushRoute(raw: Record<string, unknown>, extra: Record<string, unknown>): void {
  (raw.routes as Record<string, unknown>[]).push({ id: 'r1', number: 'Т1', type: 'Лоток', note: '', segments: [], ...extra });
}

function pushCable(raw: Record<string, unknown>, extra: Record<string, unknown>): void {
  (raw.cables as Record<string, unknown>[]).push({
    id: 'c1', number: 'К1', name: 'Линия', brand: 'ВВГ', purpose: '', fromId: 'e1', toId: 'e1',
    segmentIds: [], reservePercent: 0, reserveFixed: 0, startReserve: 0, endReserve: 0, quantity: 1, note: '',
    ...extra,
  });
}

test('старый проект без полей лотка и сечения загружается: undefined, а не 0', () => {
  const raw = rawProject();
  pushRoute(raw, {});
  pushCable(raw, {});
  const migrated = migrateProject(raw);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.routes[0].trayWidthMm, undefined);
  assert.equal(migrated.routes[0].trayHeightMm, undefined);
  assert.equal(migrated.routes[0].trayAreaMm2, undefined);
  assert.equal(migrated.cables[0].outerDiameterMm, undefined);
  assert.equal(migrated.cables[0].crossSectionMm2, undefined);
});

test('мусорные новые поля не превращаются в 0 и не роняют загрузку', () => {
  const raw = rawProject();
  raw.schemaVersion = 2;
  pushRoute(raw, { trayWidthMm: 'широкий', trayHeightMm: Number.NaN, trayAreaMm2: null });
  pushCable(raw, { outerDiameterMm: 'abc', crossSectionMm2: Number.POSITIVE_INFINITY });
  pushCable(raw, { id: 'c2', number: 'К2', outerDiameterMm: -5, crossSectionMm2: '6.5' });
  // Пустая строка, boolean и массив не должны коэрситься в 0/1/50.
  pushCable(raw, { id: 'c3', number: 'К3', outerDiameterMm: '', crossSectionMm2: '   ' });
  pushCable(raw, { id: 'c4', number: 'К4', outerDiameterMm: true, crossSectionMm2: false });
  pushCable(raw, { id: 'c5', number: 'К5', outerDiameterMm: [50], crossSectionMm2: {} });
  (raw.routes as Record<string, unknown>[]).push({
    id: 'r2', number: 'Т2', type: 'Лоток', note: '', segments: [],
    trayWidthMm: true, trayHeightMm: '', trayAreaMm2: [],
  });
  const migrated = migrateProject(raw);
  assert.equal(migrated.routes[0].trayWidthMm, undefined);
  assert.equal(migrated.routes[0].trayHeightMm, undefined);
  assert.equal(migrated.routes[0].trayAreaMm2, undefined);
  assert.equal(migrated.routes[1].trayWidthMm, undefined);
  assert.equal(migrated.routes[1].trayHeightMm, undefined);
  assert.equal(migrated.routes[1].trayAreaMm2, undefined);
  assert.equal(migrated.cables[0].outerDiameterMm, undefined);
  assert.equal(migrated.cables[0].crossSectionMm2, undefined);
  assert.equal(migrated.cables[1].outerDiameterMm, -5);
  assert.equal(migrated.cables[1].crossSectionMm2, 6.5);
  for (const index of [2, 3, 4]) {
    assert.equal(migrated.cables[index].outerDiameterMm, undefined);
    assert.equal(migrated.cables[index].crossSectionMm2, undefined);
  }
});

test('корректные размеры лотка и сечения переживают JSON round-trip', () => {
  const raw = rawProject();
  pushRoute(raw, { trayWidthMm: 100, trayHeightMm: 50, trayAreaMm2: 5000 });
  pushCable(raw, { outerDiameterMm: 6, crossSectionMm2: 28.27 });
  const first = migrateProject(raw);
  assert.equal(first.schemaVersion, 2);
  assert.equal(first.routes[0].trayWidthMm, 100);
  assert.equal(first.routes[0].trayHeightMm, 50);
  assert.equal(first.routes[0].trayAreaMm2, 5000);
  assert.equal(first.cables[0].outerDiameterMm, 6);
  assert.equal(first.cables[0].crossSectionMm2, 28.27);
  const second = migrateProject(JSON.parse(JSON.stringify(first)));
  assert.equal(second.schemaVersion, 2);
  assert.deepEqual(second.routes, first.routes);
  assert.deepEqual(second.cables, first.cables);
});

function withEquipmentColor(color: unknown, present = true): Record<string, unknown> {
  const raw = rawProject();
  const equipment = (raw.equipment as Record<string, unknown>[])[0];
  if (present) equipment.color = color;
  else delete equipment.color;
  return raw;
}

test('цвет оборудования: #rgb/#RRGGBB нормализуется в #rrggbb', () => {
  for (const [input, expected] of [['#ABC', '#aabbcc'], ['#AABBCC', '#aabbcc'], ['#aabbcc', '#aabbcc'], [' #ABC ', '#aabbcc']] as const) {
    const migrated = migrateProject(withEquipmentColor(input));
    assert.equal(migrated.equipment[0].color, expected, `цвет ${input}`);
  }
});

test('цвет оборудования: мусор и отсутствие — undefined, а не чёрный/дефолт', () => {
  for (const input of ['red', '#12', '', '   ', '#GGGGGG', 'aabbcc', 123, {}, [], true, null]) {
    const migrated = migrateProject(withEquipmentColor(input));
    assert.ok(Object.hasOwn(migrated.equipment[0], 'color'), 'поле color должно остаться в объекте');
    assert.equal(migrated.equipment[0].color, undefined, `цвет ${JSON.stringify(input)} должен стать undefined`);
  }
  for (const raw of [withEquipmentColor(undefined), withEquipmentColor(null, false)]) {
    const migrated = migrateProject(raw);
    assert.equal(migrated.equipment[0].color, undefined, 'отсутствующий цвет — undefined');
  }
});

test('корректный цвет оборудования переживает JSON round-trip', () => {
  const first = migrateProject(withEquipmentColor('#AABBCC'));
  assert.equal(first.equipment[0].color, '#aabbcc');
  const second = migrateProject(JSON.parse(JSON.stringify(first)));
  assert.equal(second.equipment[0].color, '#aabbcc');
  assert.deepEqual(second.equipment, first.equipment);
});

test('старый проект без справочника, даты прайса и сметы загружается', () => {
  const migrated = migrateProject(project());
  assert.deepEqual(migrated.catalog, []);
  assert.equal(migrated.catalogDate, undefined);
  assert.equal(migrated.estimate, undefined);
  // Старые поля не пострадали и новые необязательные поля не заменили их на 0.
  assert.equal(migrated.floors[0].metersPerUnit, 0.1);
  assert.equal(migrated.equipment[0].height, null);
});

test('мусор в справочнике цен нормализуется и не роняет загрузку', () => {
  const notArray = rawProject();
  notArray.catalog = 'нет';
  assert.deepEqual(migrateProject(notArray).catalog, []);

  const raw = rawProject();
  raw.catalog = [
    null,
    { kind: 'bad', name: 'X' },
    { kind: 'cable', name: '  ' },
    { kind: 'cable', name: ' ВВГ ', unit: 'м', price: -5 },
    { kind: 'equipment', name: 'Шкаф', price: Number.NaN },
    { kind: 'tray', name: 'Лоток', unit: 5, price: '100' },
    { id: 't2', kind: 'tray', name: 'Стояк', price: 620 },
  ];
  const catalog = migrateProject(raw).catalog ?? [];
  assert.equal(catalog.length, 4);
  assert.deepEqual(catalog[0], { id: 'price-4', kind: 'cable', name: 'ВВГ', unit: 'м', price: null, note: '' });
  assert.deepEqual(catalog[1], { id: 'price-5', kind: 'equipment', name: 'Шкаф', unit: 'шт', price: null, note: '' });
  assert.deepEqual(catalog[2], { id: 'price-6', kind: 'tray', name: 'Лоток', unit: 'шт', price: null, note: '' });
  assert.deepEqual(catalog[3], { id: 't2', kind: 'tray', name: 'Стояк', unit: 'шт', price: 620, note: '' });
});

test('смета: некорректный процент работ становится null, валидный сохраняется', () => {
  for (const estimate of ['смета', [], 5, true]) {
    const raw = rawProject();
    raw.estimate = estimate;
    assert.equal(migrateProject(raw).estimate, undefined, `оценка ${JSON.stringify(estimate)}`);
  }
  for (const laborPercent of ['25', -5, Number.NaN, Number.POSITIVE_INFINITY, null, true]) {
    const raw = rawProject();
    raw.estimate = { laborPercent, note: 5 };
    assert.deepEqual(migrateProject(raw).estimate, { laborPercent: null, note: '' }, `процент ${String(laborPercent)}`);
  }
  const zero = rawProject();
  zero.estimate = { laborPercent: 0, note: 'Без работ' };
  assert.deepEqual(migrateProject(zero).estimate, { laborPercent: 0, note: 'Без работ' });
});

test('catalogDate: валидная дата сохраняется, мусор и null — undefined', () => {
  const cases: [unknown, string | undefined][] = [
    ['2026-10-01', '2026-10-01'],
    ['2024-02-29', '2024-02-29'],
    ['2026-02-30', undefined],
    ['01.10.2026', undefined],
    ['2026-1-01', undefined],
    [null, undefined],
    [42, undefined],
  ];
  for (const [value, expected] of cases) {
    const raw = rawProject();
    raw.catalogDate = value;
    assert.equal(migrateProject(raw).catalogDate, expected, `дата ${String(value)}`);
  }
});

test('каталог, дата прайса и смета переживают JSON round-trip', () => {
  const raw = rawProject();
  raw.catalog = [
    { id: 'e1', kind: 'equipment', name: 'Шкаф питания', unit: 'шт', price: 28500, note: '' },
    { id: 'c1', kind: 'cable', name: 'КВК-П 2×0.75', unit: 'м', price: null, note: 'уточнить' },
  ];
  raw.catalogDate = '2026-10-01';
  raw.estimate = { laborPercent: 25, note: 'Цены действительны 30 дней' };
  const first = migrateProject(raw);
  assert.equal(first.schemaVersion, 2);
  assert.equal(first.catalog?.length, 2);
  assert.equal(first.catalogDate, '2026-10-01');
  assert.deepEqual(first.estimate, { laborPercent: 25, note: 'Цены действительны 30 дней' });
  const second = migrateProject(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(second.catalog, first.catalog);
  assert.equal(second.catalogDate, first.catalogDate);
  assert.deepEqual(second.estimate, first.estimate);
  assert.equal(second.catalog?.[1].price, null, 'неизвестная цена остаётся null, а не 0');
});

test('старый проект без документа загружается: document undefined, новые поля не ломают списки', () => {
  const migrated = migrateProject(project());
  assert.equal(migrated.document, undefined);
  assert.equal(migrated.schemaVersion, 2);
  for (const document of ['строка', 42, [], true, null]) {
    const raw = rawProject();
    raw.document = document;
    const result = migrateProject(raw);
    assert.equal(result.document, undefined, `документ ${JSON.stringify(document)}`);
    assert.equal(result.schemaVersion, 2);
  }
});

test('document: поля титульного листа нормализуются (trim, пусто → undefined)', () => {
  const raw = rawProject();
  raw.document = {
    organization: '  ООО «Проект-Монтаж»  ',
    object: ' Учебный объект ',
    documentCode: ' АП-2026-01 ',
    city: ' Екатеринбург ',
    title: ' Кабельный журнал и смета ',
    compiledBy: 'Инженер А.И. Петров',
    checkedBy: 'ГИП С.В. Смирнов',
    date: '2026-10-01',
  };
  assert.deepEqual(migrateProject(raw).document, {
    compiledBy: 'Инженер А.И. Петров',
    checkedBy: 'ГИП С.В. Смирнов',
    date: '2026-10-01',
    organization: 'ООО «Проект-Монтаж»',
    object: 'Учебный объект',
    documentCode: 'АП-2026-01',
    city: 'Екатеринбург',
    title: 'Кабельный журнал и смета',
  });

  const empty = rawProject();
  empty.document = { organization: '   ', object: '', documentCode: '  ', city: '', title: '\t', compiledBy: 'Иванов' };
  const document = migrateProject(empty).document!;
  for (const key of ['organization', 'object', 'documentCode', 'city', 'title'] as const) {
    assert.equal(document[key], undefined, `пустое поле ${key} должно стать undefined`);
  }
  assert.equal(document.compiledBy, 'Иванов', 'старые поля сохраняются как раньше');
});

test('changeLog: мусор и пустые записи отбрасываются, поля нормализуются', () => {
  const raw = rawProject();
  raw.document = {
    organization: 'ООО «Проект-Монтаж»',
    changeLog: [
      null,
      'строка',
      { id: '', version: ' 1 ', date: ' 2026-10-01 ', author: ' А.И. Петров ', description: ' Первая редакция ' },
      { id: 'c2', version: 2, date: null, author: true, description: {} },
      { id: '  c3  ', version: '2', date: '2026-10-15', author: 'С.В. Смирнов', description: '' },
    ],
  };
  const changeLog = migrateProject(raw).document!.changeLog!;
  assert.equal(changeLog.length, 2, 'не-объекты и полностью пустые записи отбрасываются');
  assert.deepEqual(changeLog[0], {
    id: 'change-3',
    version: '1',
    date: '2026-10-01',
    author: 'А.И. Петров',
    description: 'Первая редакция',
  });
  assert.deepEqual(changeLog[1], {
    id: 'c3',
    version: '2',
    date: '2026-10-15',
    author: 'С.В. Смирнов',
    description: '',
  });

  for (const changeLog of ['нет', null, {}, 5, [], [null], [{ version: '  ' }]]) {
    const bad = rawProject();
    bad.document = { changeLog };
    assert.equal(migrateProject(bad).document?.changeLog, undefined, `changeLog ${JSON.stringify(changeLog)}`);
  }
});

test('валидный документ и лист изменений переживают JSON round-trip', () => {
  const raw = rawProject();
  raw.document = {
    organization: 'ООО «Проект-Монтаж»',
    object: 'Учебный объект: офис на 2 этажа',
    documentCode: 'АП-2026-01',
    city: 'Екатеринбург',
    title: 'Кабельный журнал и смета',
    compiledBy: 'Инженер А.И. Петров',
    checkedBy: 'ГИП С.В. Смирнов',
    date: '2026-10-01',
    changeLog: [
      { id: 'ch1', version: '1', date: '2026-10-01', author: 'А.И. Петров', description: 'Первая редакция' },
      { id: 'ch2', version: '2', date: '2026-10-15', author: 'С.В. Смирнов', description: 'Уточнён справочник цен и смета' },
    ],
  };
  const first = migrateProject(raw);
  assert.equal(first.document?.organization, 'ООО «Проект-Монтаж»');
  assert.equal(first.document?.changeLog?.length, 2);
  const second = migrateProject(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(second.document, first.document);
  assert.equal(second.document?.changeLog?.[1].description, 'Уточнён справочник цен и смета');
});

test('документ демо-проекта переживает загрузку без потерь', () => {
  const demo = createDemoProject();
  const loaded = migrateProject(JSON.parse(JSON.stringify(demo)));
  assert.equal(loaded.document?.organization, 'ООО «Проект-Монтаж»');
  assert.equal(loaded.document?.documentCode, 'АП-2026-01');
  assert.equal(loaded.document?.city, 'Екатеринбург');
  assert.equal(loaded.document?.title, 'Кабельный журнал и смета');
  assert.equal(loaded.document?.changeLog?.length, 2);
  assert.deepEqual(loaded.document?.changeLog, demo.document?.changeLog);
});

test('changeLog разводит дубли id, включая fallback change-N', () => {
  const raw = rawProject();
  raw.document = {
    changeLog: [
      { id: 'change-2', version: '1', date: '2026-01-01', author: 'A', description: 'Первая' },
      { version: '2', date: '2026-01-02', author: 'B', description: 'Вторая (без id)' },
      { id: 'change-2', version: '3', date: '2026-01-03', author: 'C', description: 'Третья (дубль)' },
    ],
  };
  const migrated = migrateProject(raw);
  const entries = migrated.document?.changeLog ?? [];
  assert.equal(entries.length, 3);
  const ids = entries.map(entry => entry.id);
  assert.equal(new Set(ids).size, ids.length, `дубли id: ${ids.join(', ')}`);
  assert.equal(entries[0].id, 'change-2');
  assert.equal(entries[2].description, 'Третья (дубль)');
});


test('размеры между оборудованием нормализуются, мусор отбрасывается', () => {
  const source = project() as unknown as Record<string, unknown>;
  source.dimensions = [
    { id: 'd1', fromId: 'e1', toId: 'e2' },
    { id: '', fromId: 'e1', toId: 'e2' },
    { id: 'd2', fromId: 'e1', toId: 'e1' },
    { id: 'd3', fromId: 42, toId: 'e2' },
  ];
  const migrated = migrateProject(source);
  assert.deepEqual(migrated.dimensions, [{ id: 'd1', fromId: 'e1', toId: 'e2', note: '' }]);
});


test('подсистема трассы и артикулы справочника сохраняются при миграции', () => {
  const source = project() as unknown as Record<string, unknown>;
  source.routes = [{ id: 'r1', number: 'Т1', type: 'Кабель-канал', note: '', subsystem: 'trunk', segments: [] }];
  source.catalog = [{ id: 'c1', kind: 'tray', name: 'Кабель-канал', unit: 'м', price: 100, note: '', article: 'KK-1', manufacturer: 'DKC' }];
  const migrated = migrateProject(source);
  assert.equal(migrated.routes[0].subsystem, 'trunk');
  assert.equal(migrated.catalog?.[0].article, 'KK-1');
  assert.equal(migrated.catalog?.[0].manufacturer, 'DKC');
});

test('сегментные размеры КНС: строки становятся числами, мусор считается отсутствующим', () => {
  const demo = createDemoProject();
  const raw = JSON.parse(JSON.stringify(demo)) as Record<string, unknown>;
  const segmentRows = (raw.routes as { segments: Record<string, unknown>[] }[])[0].segments;
  assert.ok(segmentRows.length >= 2);
  segmentRows[0].trayWidthMm = 50;
  segmentRows[0].trayHeightMm = 25;
  segmentRows[1].trayWidthMm = '40';
  segmentRows[1].trayAreaMm2 = 1256;
  segmentRows[1].trayHeightMm = 'не число';

  const migrated = migrateProject(raw);
  const [first, second] = migrated.routes[0].segments;
  assert.equal(first.trayWidthMm, 50);
  assert.equal(first.trayHeightMm, 25);
  assert.equal(second.trayWidthMm, 40, 'числовая строка из старой копии приводится к числу');
  assert.equal(second.trayAreaMm2, 1256);
  assert.equal('trayHeightMm' in second, false, 'мусор не превращается в 0');
  // Сегменты без переопределения не получают новых полей.
  const untouched = migrated.routes[0].segments[2];
  assert.equal('trayWidthMm' in untouched, false);

  // Нули и отрицательные размеры сохраняются: их ловит валидация, а не миграция.
  const zeroRaw = JSON.parse(JSON.stringify(demo)) as Record<string, unknown>;
  const zeroSegments = (zeroRaw.routes as { segments: Record<string, unknown>[] }[])[0].segments;
  zeroSegments[0].trayWidthMm = 0;
  zeroSegments[0].trayAreaMm2 = -1;
  const zeroMigrated = migrateProject(zeroRaw);
  assert.equal(zeroMigrated.routes[0].segments[0].trayWidthMm, 0);
  assert.equal(zeroMigrated.routes[0].segments[0].trayAreaMm2, -1);

  // Переопределения переживают JSON round-trip без потерь.
  const roundTrip = migrateProject(JSON.parse(JSON.stringify(migrated)));
  assert.deepEqual(roundTrip.routes[0].segments, migrated.routes[0].segments);
});

test('битый сегмент (строка вместо объекта) отбрасывается, а не роняет загрузку', () => {
  const raw = JSON.parse(JSON.stringify(createDemoProject())) as Record<string, unknown>;
  const routes = raw.routes as { segments: unknown[] }[];
  routes[0].segments[0] = 'not-a-segment';
  routes[0].segments[1] = { id: 'bad', a: null, b: {} };
  const migrated = migrateProject(raw);
  assert.equal(migrated.routes[0].segments.length, 2, 'два битых сегмента отброшены из четырёх');
  assert.ok(migrated.routes[0].segments.every(segment => segment.a && segment.b));
});
