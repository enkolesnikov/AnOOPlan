// Общие фикстуры юнит-тестов AnOOPlan.
//
// Раньше каждый тест объявлял свои vertex/segment/device/cable и полный проект —
// объекты дублировались в 12 файлах. Здесь собраны канонические конструкторы:
// тесты передают только отличия, а литералы структуры живут в одном месте.
// Значения по умолчанию подобраны так, чтобы поведение существующих тестов
// не менялось (в частности, высота вершины по умолчанию — 3 м, как в engine).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Cable, Equipment, Floor, Pin, PriceItem, Project, Route, Segment, Vertex } from '../src/model';
import { ApiError, assertProject } from '../server/validation.js';

/** Корень репозитория (тесты лежат в tests/). */
export const ROOT = join(import.meta.dirname, '..');

/** Прочитать файл проекта относительно корня репозитория. */
export const readRepoFile = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

export const vertex = (id: string, x: number, y = 0, height: number | null = 3, floorId = 'f1'): Vertex =>
  ({ id, x, y, height, floorId });

export const segment = (id: string, a: Vertex, b: Vertex, extra: Partial<Segment> = {}): Segment =>
  ({ id, a, b, mode: 'orthogonal', reservePercent: 0, reserveFixed: 0, ...extra });

export const floor = (id: string, extra: Partial<Floor> = {}): Floor =>
  ({ id, name: 'Этаж', elevation: 0, metersPerUnit: 0.1, page: 1, width: 1000, height: 700, ...extra });

/** Оборудование-«датчик» с моделью Д-1: так его видят engine, смета и экспорт. */
export const device = (id: string, x: number, extra: Partial<Equipment> = {}): Equipment => ({
  id, number: id, name: `Датчик ${id}`, type: 'Датчик', floorId: 'f1', x, y: 0, height: 1, note: '',
  properties: { model: 'Д-1' }, ...extra,
});

export const cable = (extra: Partial<Cable> = {}): Cable => ({
  id: 'c', number: 'К1', name: 'Линия', brand: 'ВВГ', purpose: '', fromId: 'a', toId: 'b', segmentIds: ['s'],
  reservePercent: 0, reserveFixed: 0, startReserve: 0, endReserve: 0, quantity: 1, note: '', ...extra,
});

export const route = (id: string, segments: Segment[], extra: Partial<Route> = {}): Route =>
  ({ id, number: 'Т1', type: 'Лоток', note: '', segments, ...extra });

export const pin = (id: string, extra: Partial<Pin> = {}): Pin => ({
  id, number: `З-${id}`, floorId: 'f1', x: 1, y: 2, comment: '', status: 'open',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...extra,
});

export const priceItem = (id: string, extra: Partial<PriceItem> = {}): PriceItem =>
  ({ id, kind: 'equipment', name: id, unit: 'шт', price: null, note: '', ...extra });

/** Минимальный проект: два этажа, два устройства, одна трасса из одного сегмента и один кабель. */
export function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    schemaVersion: 2, id: 'p', name: 'Тест', updatedAt: '2026-01-01T00:00:00Z',
    floors: [floor('f1', { name: 'Первый' }), floor('f2', { name: 'Второй', elevation: 4, page: 2 })],
    equipment: [device('a', 0), device('b', 100)],
    routes: [route('r', [segment('s', vertex('v1', 0), vertex('v2', 100))])],
    pins: [],
    cables: [cable()],
    ...overrides,
  };
}

/** Сравнить число с допуском (null не равен ожиданию — как в тестах расчётов). */
export const closeTo = (actual: number | null, expected: number, epsilon = 1e-9): void => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) < epsilon, `${actual} != ${expected}`);
};

/** Рекурсивно заморозить значение: проверка, что расчёт не мутирует проект. */
export const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
};

/** Ожидать, что валидатор отклонит проект с 422 и текстом, подходящим под pattern. */
export const rejectsProject = (input: unknown, pattern: RegExp): void => {
  assert.throws(
    () => assertProject(input, () => true),
    (error: unknown) => error instanceof ApiError && error.status === 422 && pattern.test(error.message),
  );
};
