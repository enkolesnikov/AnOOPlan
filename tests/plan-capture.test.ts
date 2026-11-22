import test from 'node:test';
import assert from 'node:assert/strict';
import type { Equipment, Floor, Pin, Project, Route } from '../src/model';
import { groupFloorsByPdf, planFloors } from '../src/plan-pages';

function floor(id: string, name: string, page = 1, pdfId?: string): Floor {
  return { id, name, elevation: null, metersPerUnit: null, pdfId, page, width: 1000, height: 700 };
}

function project(floors: Floor[], parts: Partial<Project> = {}): Project {
  return {
    schemaVersion: 2,
    id: 'project-1',
    name: 'Проект',
    floors,
    equipment: [],
    routes: [],
    cables: [],
    pins: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...parts,
  };
}

function equipment(id: string, floorId: string): Equipment {
  return { id, number: id, name: 'Розетка', type: 'rj45', floorId, x: 10, y: 20, height: null, note: '', properties: {} };
}

function pin(id: string, floorId: string): Pin {
  return { id, number: id, floorId, x: 10, y: 20, comment: 'Замечание', status: 'open', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}

function route(id: string, fromFloor: string, toFloor: string): Route {
  return {
    id,
    number: id,
    type: 'tray',
    note: '',
    segments: [{
      id: `${id}-1`,
      a: { id: `${id}-a`, floorId: fromFloor, x: 0, y: 0, height: null },
      b: { id: `${id}-b`, floorId: toFloor, x: 100, y: 0, height: null },
      mode: 'orthogonal',
      reservePercent: 0,
      reserveFixed: 0,
    }],
  };
}

test('этаж только с пинами-замечаниями попадает в листы плана', () => {
  const floors = [floor('f1', 'Этаж 1'), floor('f2', 'Этаж 2')];
  const result = planFloors(project(floors, { pins: [pin('p1', 'f2')] }));
  assert.deepEqual(result.map(item => item.id), ['f2']);
});

test('пустой этаж без оборудования, трасс и пинов листа не получает', () => {
  const floors = [floor('f1', 'Этаж 1'), floor('f2', 'Этаж 2'), floor('f3', 'Этаж 3')];
  const result = planFloors(project(floors, { equipment: [equipment('e1', 'f1')], routes: [route('r1', 'f1', 'f3')] }));
  assert.deepEqual(result.map(item => item.id), ['f1', 'f3']);
});

test('порядок этажей плана совпадает с порядком этажей проекта', () => {
  const floors = [floor('f3', 'Этаж 3'), floor('f1', 'Этаж 1'), floor('f2', 'Этаж 2')];
  const result = planFloors(project(floors, { pins: [pin('p1', 'f2')], equipment: [equipment('e1', 'f1')] }));
  assert.deepEqual(result.map(item => item.id), ['f1', 'f2']);
});

test('groupFloorsByPdf объединяет этажи с общим PDF и отделяет остальные', () => {
  const floors = [
    floor('f1', 'Этаж 1', 1, 'shared.pdf'),
    floor('f2', 'Этаж 2', 2, 'shared.pdf'),
    floor('f3', 'Этаж 3', 1, 'other.pdf'),
    floor('f4', 'Этаж 4', 1),
    floor('f5', 'Этаж 5', 2, '   '),
  ];
  const groups = groupFloorsByPdf(floors);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].pdfId, 'shared.pdf');
  assert.deepEqual(groups[0].floors.map(item => item.id), ['f1', 'f2']);
  assert.equal(groups[1].pdfId, 'other.pdf');
  assert.deepEqual(groups[1].floors.map(item => item.id), ['f3']);
  assert.equal(groups[2].pdfId, null);
  assert.deepEqual(groups[2].floors.map(item => item.id), ['f4', 'f5']);
});
