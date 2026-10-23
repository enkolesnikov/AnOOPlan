import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EQUIPMENT_COLOR_PRESETS,
  EQUIPMENT_ICON_GLYPHS,
  type EquipmentIconId,
  equipmentColor,
  equipmentIcon,
  equipmentIconLabel,
  normalizeEquipmentColor,
} from '../src/equipment-icons';

const HEX = /^#[0-9a-f]{6}$/;

test('тип оборудования превращается в иконку, регистр и свободный текст не мешают', () => {
  const cases: Array<[string, EquipmentIconId]> = [
    ['Камера', 'camera'],
    ['Камера PTZ', 'camera'],
    ['камера', 'camera'],
    ['Видеокамера уличная', 'camera'],
    ['Шкаф', 'cabinet'],
    ['Шкаф телекоммуникационный', 'cabinet'],
    ['Розетка', 'socket'],
    ['Розетка у входа', 'socket'],
    ['Коммутатор', 'switch'],
    ['Коммутатор PoE', 'switch'],
    ['Считыватель', 'reader'],
    ['Считыватель карт', 'reader'],
    ['Датчик', 'generic'],
    ['', 'generic'],
    ['   ', 'generic'],
  ];
  for (const [type, icon] of cases) assert.equal(equipmentIcon(type), icon, `тип «${type}»`);
});

test('подписи иконок на русском, для неизвестного типа — «Оборудование»', () => {
  assert.equal(equipmentIconLabel('Камера'), 'Камера');
  assert.equal(equipmentIconLabel('Шкаф'), 'Шкаф');
  assert.equal(equipmentIconLabel('Розетка'), 'Розетка');
  assert.equal(equipmentIconLabel('Коммутатор'), 'Коммутатор');
  assert.equal(equipmentIconLabel('Считыватель'), 'Считыватель');
  assert.equal(equipmentIconLabel('Датчик'), 'Оборудование');
  assert.equal(equipmentIconLabel(''), 'Оборудование');
});

test('у каждой иконки есть непустые контуры в системе 24×24', () => {
  const icons: EquipmentIconId[] = ['camera', 'cabinet', 'socket', 'switch', 'reader', 'generic'];
  for (const icon of icons) {
    const glyph = EQUIPMENT_ICON_GLYPHS[icon];
    assert.ok(glyph, `нет глифа ${icon}`);
    assert.ok(Array.isArray(glyph.paths) && glyph.paths.length > 0, `глиф ${icon} без контуров`);
    for (const path of glyph.paths) {
      assert.equal(typeof path, 'string', `контур ${icon} — не строка`);
      assert.ok(path.startsWith('M'), `контур ${icon} должен начинаться с M: ${path}`);
      assert.ok(path.length >= 16, `контур ${icon} подозрительно короткий`);
      assert.ok(!path.includes('undefined') && !path.includes('NaN'), `в контуре ${icon} мусор: ${path}`);
      // Только команды пути и числа: заливка не должна зависеть от лишних элементов.
      assert.match(path, /^[MmLlHhVvCcSsQqTtAaZz0-9.,\-+\s]+$/, `недопустимые символы в контуре ${icon}`);
    }
  }
});

test('пресеты — 8 валидных уникальных цветов #rrggbb', () => {
  assert.equal(EQUIPMENT_COLOR_PRESETS.length, 8);
  const seen = new Set<string>();
  for (const preset of EQUIPMENT_COLOR_PRESETS) {
    assert.equal(typeof preset, 'string');
    assert.match(preset, HEX, `невалидный пресет ${String(preset)}`);
    assert.ok(!seen.has(preset), `повтор пресета ${preset}`);
    seen.add(preset);
    assert.equal(normalizeEquipmentColor(preset), preset, 'пресет должен нормализоваться в себя');
  }
});

test('цвета по умолчанию валидны и различают камеру, шкаф и розетку', () => {
  const camera = equipmentColor({ type: 'Камера' });
  const cabinet = equipmentColor({ type: 'Шкаф' });
  const socket = equipmentColor({ type: 'Розетка' });
  for (const color of [camera, cabinet, socket]) assert.match(color, HEX, `невалидный цвет по умолчанию ${color}`);
  assert.notEqual(camera, cabinet);
  assert.notEqual(camera, socket);
  assert.notEqual(cabinet, socket);
  assert.ok((EQUIPMENT_COLOR_PRESETS as readonly string[]).includes(cabinet), 'цвет шкафа должен быть из палитры пресетов');
});

test('normalizeEquipmentColor: #rgb → #rrggbb, мусор → null, без подмены дефолтом', () => {
  assert.equal(normalizeEquipmentColor('#ABC'), '#aabbcc');
  assert.equal(normalizeEquipmentColor('#AABBCC'), '#aabbcc');
  assert.equal(normalizeEquipmentColor('#aabbcc'), '#aabbcc');
  assert.equal(normalizeEquipmentColor(' #aabbcc '), '#aabbcc');
  for (const value of ['red', '#12', '', '   ', '#12345', '#1234567', '#GGGGGG', 'aabbcc', null, undefined, 123, {}, [], true]) {
    assert.equal(normalizeEquipmentColor(value), null, `значение ${JSON.stringify(value)} должно быть отклонено`);
  }
});

test('глифы разных типов различаются и валидны', () => {
  const ids = Object.keys(EQUIPMENT_ICON_GLYPHS) as (keyof typeof EQUIPMENT_ICON_GLYPHS)[];
  const shapes = ids.map(id => EQUIPMENT_ICON_GLYPHS[id].paths.join('|'));
  assert.equal(new Set(shapes).size, ids.length, 'у каждого типа оборудования свой набор контуров');
  for (const id of ids) {
    const glyph = EQUIPMENT_ICON_GLYPHS[id];
    assert.ok(glyph.paths.length >= 1 && glyph.paths.length <= 4, `${id}: неожиданное число контуров`);
    for (const path of glyph.paths) {
      assert.match(path, /^M[\d\s.,-]+/, `${id}: контур должен начинаться с M`);
      assert.doesNotMatch(path, /undefined|NaN/, `${id}: в контуре мусор`);
    }
  }
});

test('equipmentColor: сохранённый цвет, иначе цвет по умолчанию для типа', () => {
  assert.equal(equipmentColor({ type: 'Камера', color: '#ABC' }), '#aabbcc');
  assert.equal(equipmentColor({ type: 'Камера', color: '#875ec5' }), '#875ec5');
  assert.equal(equipmentColor({ type: 'Камера', color: 'red' }), equipmentColor({ type: 'Камера' }), 'мусор → цвет по типу');
  assert.equal(equipmentColor({ type: 'Камера', color: null }), equipmentColor({ type: 'Камера' }));
  assert.equal(equipmentColor({ type: 'Камера' }), '#122936', 'без цвета — дефолт камеры');
  assert.notEqual(equipmentColor({ type: 'Камера' }), equipmentColor({ type: 'Шкаф' }));
  assert.equal(equipmentColor({ type: 'Датчик', color: '#3f6ad8' }), '#3f6ad8', 'у неизвестного типа сохранённый цвет важнее');
});
