import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateProject } from '../src/migrations';
import { createDemoProject } from '../src/demo';
import type { Project } from '../src/model';
import { validateProject } from '../src/engine';

/**
 * C-09: миграции не подменяют повреждённые quantity/запасы правдоподобными
 * числами. Количество 0, отрицательное или дробное сохраняется как есть, а
 * отсутствующее/нечисловое становится NaN — движок сам показывает ошибку.
 */

const QUANTITY_ERROR = /количество должно быть положительным целым/;
const RESERVE_ERROR = /запасы должны быть конечными неотрицательными/;
const END_RESERVE_ERROR = /неверные концевые запасы/;

/** Демо-проект валиден, поэтому любая ошибка в тестах — от испорченного поля. */
function rawDemo(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(createDemoProject())) as Record<string, unknown>;
}

function cableAt(raw: Record<string, unknown>, index = 0): Record<string, unknown> {
  return (raw.cables as Record<string, unknown>[])[index];
}

function hasError(migrated: Project, pattern: RegExp): boolean {
  const errors = validateProject(migrated);
  return errors.some(error => pattern.test(error));
}

test('quantity=0 из JSON остаётся нулём и даёт ошибку количества', () => {
  const raw = rawDemo();
  cableAt(raw).quantity = 0;
  // Имитируем файл: 0 пишется как 0 и читается обратно.
  const migrated = migrateProject(JSON.parse(JSON.stringify(raw)));
  assert.equal(migrated.cables[0].quantity, 0, '0 не подменяется на 1');
  assert.ok(hasError(migrated, QUANTITY_ERROR), validateProject(migrated).join('; '));
});

test('quantity=NaN и мусор не превращаются в 1, а остаются неизвестными', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 'много', '  ', true, [], {}, null]) {
    const raw = rawDemo();
    cableAt(raw).quantity = value;
    const migrated = migrateProject(raw);
    const quantity = migrated.cables[0].quantity;
    assert.ok(Number.isNaN(quantity), `quantity ${String(value)} → NaN, получено ${String(quantity)}`);
    assert.notEqual(quantity, 1, `quantity ${String(value)} не должно становиться 1`);
    assert.ok(hasError(migrated, QUANTITY_ERROR), `quantity ${String(value)}: ${validateProject(migrated).join('; ')}`);
  }

  // Отсутствующее поле — тоже «неизвестно», а не «один кабель».
  const missing = rawDemo();
  delete cableAt(missing).quantity;
  const migrated = migrateProject(missing);
  assert.ok(Number.isNaN(migrated.cables[0].quantity));
  assert.ok(hasError(migrated, QUANTITY_ERROR));
});

test('цикл сохранение→загрузка: 0 остаётся 0, NaN становится null и снова NaN', () => {
  const zeroRaw = rawDemo();
  cableAt(zeroRaw).quantity = 0;
  const zeroFirst = migrateProject(zeroRaw);
  const zeroSaved = JSON.parse(JSON.stringify(zeroFirst)) as Record<string, unknown>;
  assert.equal(cableAt(zeroSaved).quantity, 0, '0 переживает JSON round-trip');
  const zeroSecond = migrateProject(zeroSaved);
  assert.equal(zeroSecond.cables[0].quantity, 0);
  assert.ok(hasError(zeroSecond, QUANTITY_ERROR));

  const nanRaw = rawDemo();
  cableAt(nanRaw).quantity = Number.NaN;
  const nanFirst = migrateProject(nanRaw);
  assert.ok(Number.isNaN(nanFirst.cables[0].quantity));
  // JSON.stringify(NaN) → null; это документированное поведение, а не «починка».
  const nanSaved = JSON.parse(JSON.stringify(nanFirst)) as Record<string, unknown>;
  assert.equal(cableAt(nanSaved).quantity, null);
  const nanSecond = migrateProject(nanSaved);
  assert.ok(Number.isNaN(nanSecond.cables[0].quantity), 'null при загрузке снова становится NaN');
  assert.notEqual(nanSecond.cables[0].quantity, 1);
  assert.ok(hasError(nanSecond, QUANTITY_ERROR));
});

test('запас cable reservePercent=NaN не становится 0 и ловится reserveErrors', () => {
  const raw = rawDemo();
  cableAt(raw).reservePercent = Number.NaN;
  const migrated = migrateProject(raw);
  const reservePercent = migrated.cables[0].reservePercent;
  assert.ok(Number.isNaN(reservePercent), `reservePercent=${String(reservePercent)}`);
  assert.notEqual(reservePercent, 0, 'NaN не подменяется нулём');
  assert.ok(hasError(migrated, RESERVE_ERROR), validateProject(migrated).join('; '));

  // Мусор тоже не становится нулём; отрицательные по-прежнему ловятся движком.
  for (const value of ['много', true, {}, Number.POSITIVE_INFINITY]) {
    const bad = rawDemo();
    cableAt(bad).reserveFixed = value;
    const result = migrateProject(bad);
    assert.ok(Number.isNaN(result.cables[0].reserveFixed), `reserveFixed ${String(value)} → NaN`);
    assert.ok(hasError(result, RESERVE_ERROR), `reserveFixed ${String(value)}: ${validateProject(result).join('; ')}`);
  }

  const negative = rawDemo();
  cableAt(negative).reservePercent = -5;
  const negativeResult = migrateProject(negative);
  assert.equal(negativeResult.cables[0].reservePercent, -5);
  assert.ok(hasError(negativeResult, RESERVE_ERROR));
});

test('концевые запасы startReserve/endReserve: NaN и мусор ловятся, 0 валиден', () => {
  for (const field of ['startReserve', 'endReserve'] as const) {
    for (const value of [Number.NaN, 'не число', true, {}]) {
      const raw = rawDemo();
      cableAt(raw)[field] = value;
      const migrated = migrateProject(raw);
      assert.ok(Number.isNaN(migrated.cables[0][field]), `${field} ${String(value)} → NaN`);
      assert.ok(hasError(migrated, END_RESERVE_ERROR), `${field} ${String(value)}: ${validateProject(migrated).join('; ')}`);
    }
  }

  const zero = rawDemo();
  cableAt(zero).startReserve = 0;
  cableAt(zero).endReserve = 0;
  const zeroResult = migrateProject(zero);
  assert.equal(zeroResult.cables[0].startReserve, 0);
  assert.equal(zeroResult.cables[0].endReserve, 0);
  assert.deepEqual(validateProject(zeroResult), [], 'нулевые запасы валидны');
});

test('отсутствующие запасы старого файла остаются нулевыми (совместимость)', () => {
  const raw = rawDemo();
  for (const field of ['reservePercent', 'reserveFixed', 'startReserve', 'endReserve']) delete cableAt(raw)[field];
  const migrated = migrateProject(raw);
  assert.deepEqual(
    [migrated.cables[0].reservePercent, migrated.cables[0].reserveFixed, migrated.cables[0].startReserve, migrated.cables[0].endReserve],
    [0, 0, 0, 0],
  );
  assert.deepEqual(validateProject(migrated), [], 'проект без полей запасов не ломается');
});

test('запас сегмента NaN не маскируется миграцией', () => {
  const raw = rawDemo();
  const segments = (raw.routes as { segments: Record<string, unknown>[] }[])[0].segments;
  segments[0].reservePercent = Number.NaN;
  const migrated = migrateProject(raw);
  assert.ok(Number.isNaN(migrated.routes[0].segments[0].reservePercent), 'NaN переживает миграцию как NaN');
  assert.ok(hasError(migrated, RESERVE_ERROR), validateProject(migrated).join('; '));
});

test('строки из старых копий по-прежнему становятся числами', () => {
  const raw = rawDemo();
  cableAt(raw).quantity = '2';
  cableAt(raw).reservePercent = '10';
  cableAt(raw).reserveFixed = '0.5';
  cableAt(raw).startReserve = '0.5';
  cableAt(raw).endReserve = '0.5';
  const migrated = migrateProject(raw);
  const cable = migrated.cables[0];
  assert.deepEqual([cable.quantity, cable.reservePercent, cable.reserveFixed, cable.startReserve, cable.endReserve], [2, 10, 0.5, 0.5, 0.5]);
  assert.deepEqual(validateProject(migrated), []);

  // Дробное количество из строки сохраняется как есть: ошибку даёт движок.
  const fractional = rawDemo();
  cableAt(fractional).quantity = '6.5';
  const fractionalResult = migrateProject(fractional);
  assert.equal(fractionalResult.cables[0].quantity, 6.5);
  assert.ok(hasError(fractionalResult, QUANTITY_ERROR));
});

test('нормальный проект с quantity=2 и запасом 10 грузится без изменений', () => {
  const demo = createDemoProject();
  const migrated = migrateProject(JSON.parse(JSON.stringify(demo)) as Record<string, unknown>);
  const cable = migrated.cables[2];
  assert.equal(cable.quantity, 2);
  assert.equal(cable.reservePercent, 10);
  assert.equal(cable.reserveFixed, 0);
  assert.equal(cable.startReserve, 0.5);
  assert.equal(cable.endReserve, 0.5);
  assert.deepEqual(validateProject(migrated), [], 'валидный проект остаётся валидным');
});
