import test from 'node:test';
import assert from 'node:assert/strict';
import {
  builtInTemplates, instantiateTemplate, readCustomTemplates, saveCustomTemplate,
  deleteCustomTemplate, templateProject,
} from '../src/templates';

test('шаблоны: встроенные проекты валидны и без PDF', () => {
  const templates = builtInTemplates();
  assert.equal(templates.length, 4);
  for (const template of templates) {
    assert.ok(template.project.floors.length >= 1);
    assert.ok(template.project.floors.every(floor => !floor.pdfId));
    assert.ok(template.project.equipment.every(item => item.floorId));
  }
  const warehouse = templates.find(item => item.id === 'warehouse')!;
  assert.equal(warehouse.project.floors.length, 1);
  assert.ok(warehouse.project.equipment.length >= 3);
  assert.ok(warehouse.project.cables.every(cable => cable.segmentIds.length > 0));
});

test('шаблоны: новый проект получает новый id и имя', () => {
  const office = builtInTemplates().find(item => item.id === 'office')!;
  const a = instantiateTemplate(office, 'Офис А');
  const b = instantiateTemplate(office, 'Офис Б');
  assert.notEqual(a.id, b.id);
  assert.equal(a.name, 'Офис А');
  assert.equal(b.name, 'Офис Б');
  assert.ok(a.floors[0].id);
  assert.equal(a.floors.length, office.project.floors.length);
});

test('шаблоны: кастомные сохраняются, читаются и удаляются', () => {
  const storage = new Map<string, string>();
  const adapter = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value) };
  const source = builtInTemplates()[1].project;
  const saved = saveCustomTemplate(source, 'Мой шаблон', adapter);
  assert.equal(readCustomTemplates(adapter).length, 1);
  assert.equal(readCustomTemplates(adapter)[0].name, 'Мой шаблон');
  assert.ok(readCustomTemplates(adapter)[0].project.floors.every(floor => !floor.pdfId));
  deleteCustomTemplate(saved.id, adapter);
  assert.equal(readCustomTemplates(adapter).length, 0);
});

test('шаблоны: вложения и история изменений не попадают в шаблон', () => {
  const source = builtInTemplates()[1].project;
  source.equipment[0].photos = ['photo-1'];
  source.document = { ...source.document, changeLog: [{ id: 'x', version: '1', date: '2026-01-01', author: 'A', description: 'd' }] };
  const copy = templateProject(source, 'Копия');
  assert.equal(copy.equipment[0].photos?.length, 0);
  assert.equal(copy.document?.changeLog?.length, 0);
});
