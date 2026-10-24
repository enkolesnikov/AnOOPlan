import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANOOPLAN_EXTENSION,
  ANOOPLAN_FORMAT,
  ANOOPLAN_FORMAT_VERSION,
  ANOOPLAN_MIME,
  buildAnoPlanFile,
  isAnoPlanFileName,
  parseAnoPlanFile,
  serializeAnoPlanFile,
} from '../src/project-file';
import type { ProjectPhotoAttachment, ProjectPdfAttachment } from '../src/project-file';
import { migrateProject, ProjectSchemaError } from '../src/migrations';
import { createDemoProject } from '../src/demo';
import { ApiError, assertProject } from '../server/validation.js';
import type { Project } from '../src/model';

function project(): Project {
  return {
    schemaVersion: 2, id: 'p1', name: 'Проект обмена', updatedAt: '2026-01-01T00:00:00Z',
    floors: [{ id: 'f1', name: 'Этаж', elevation: 0, metersPerUnit: 0.1, page: 1, width: 1000, height: 700 }],
    equipment: [{ id: 'e1', number: 'E1', name: 'Камера', type: 'Камера', floorId: 'f1', x: 1, y: 2, height: null, note: '', properties: {} }],
    routes: [], cables: [], pins: [],
  };
}

const PDFS: ProjectPdfAttachment[] = [{ id: 'idb:plan-1', name: 'plan.pdf', dataBase64: 'JVBERi0xLjQK' }];
const PHOTOS: ProjectPhotoAttachment[] = [{ key: 'photo-1', name: 'foto.jpg', mime: 'image/jpeg', dataBase64: 'Zm90bw==' }];

test('константы формата .anooplan и распознавание имени файла', () => {
  assert.equal(ANOOPLAN_EXTENSION, '.anooplan');
  assert.equal(ANOOPLAN_MIME, 'application/vnd.anooplan.project');
  assert.equal(ANOOPLAN_FORMAT, 'anooplan');
  assert.equal(ANOOPLAN_FORMAT_VERSION, 1);
  for (const name of ['проект.anooplan', 'ПРОЕКТ.ANOOPLAN', ' проект.anooplan ', '.anooplan']) {
    assert.equal(isAnoPlanFileName(name), true, `имя «${name}»`);
  }
  for (const name of ['проект.json', 'anooplan', 'проект.anooplan.zip', '']) {
    assert.equal(isAnoPlanFileName(name), false, `имя «${name}»`);
  }
});

test('build/serialize/parse: проект, PDF и фото переживают roundtrip', () => {
  const source = createDemoProject();
  const file = buildAnoPlanFile(source, PDFS, PHOTOS);
  assert.equal(file.format, ANOOPLAN_FORMAT);
  assert.equal(file.formatVersion, ANOOPLAN_FORMAT_VERSION);
  assert.equal(file.project, source);
  assert.deepEqual(file.pdfs, PDFS);
  assert.deepEqual(file.photos, PHOTOS);
  assert.ok(Number.isFinite(Date.parse(file.exportedAt)), 'дата экспорта должна быть валидной');

  const parsed = parseAnoPlanFile(JSON.parse(serializeAnoPlanFile(file)));
  assert.equal(parsed.kind, 'file');
  if (parsed.kind !== 'file') throw new Error('ожидался файл с вложениями');
  assert.equal(parsed.project.id, source.id);
  assert.equal(parsed.project.schemaVersion, 2);
  assert.deepEqual(parsed.pdfs, PDFS);
  assert.deepEqual(parsed.photos, PHOTOS);
  const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
  assert.deepEqual(asJson(parsed.project.document), asJson(source.document), 'документ проекта сохранён');
  assert.deepEqual(asJson(parsed.project.catalog), asJson(source.catalog), 'справочник цен сохранён');
  assert.deepEqual(asJson(parsed.project.cables), asJson(source.cables));
});

test('build без вложений создаёт пустые массивы', () => {
  const file = buildAnoPlanFile(project());
  assert.deepEqual(file.pdfs, []);
  assert.deepEqual(file.photos, []);
});

test('parse: legacy-копия { project, pdfs, photos }', () => {
  const backup = { schemaVersion: 2, project: JSON.parse(JSON.stringify(project())), pdfs: PDFS, photos: PHOTOS };
  const parsed = parseAnoPlanFile(backup);
  assert.equal(parsed.kind, 'file');
  if (parsed.kind !== 'file') return;
  assert.equal(parsed.project.id, 'p1');
  assert.equal(parsed.project.schemaVersion, 2);
  assert.deepEqual(parsed.pdfs, PDFS);
  assert.deepEqual(parsed.photos, PHOTOS);

  const withoutAttachments = parseAnoPlanFile({ project: project() });
  assert.equal(withoutAttachments.kind, 'file');
  if (withoutAttachments.kind !== 'file') return;
  assert.deepEqual(withoutAttachments.pdfs, []);
  assert.deepEqual(withoutAttachments.photos, []);
});

test('parse: «голый» JSON-проект и его миграция', () => {
  const parsed = parseAnoPlanFile(JSON.parse(JSON.stringify(project())));
  assert.equal(parsed.kind, 'project');
  if (parsed.kind !== 'project') return;
  assert.equal(parsed.project.id, 'p1');
  assert.deepEqual(parsed.project.catalog, [], 'новые поля нормализуются миграциями');

  const legacy = JSON.parse(JSON.stringify(project())) as Record<string, unknown>;
  legacy.schemaVersion = 1;
  legacy.document = {
    organization: '  ООО «Проект-Монтаж»  ',
    title: '  Кабельный журнал  ',
    changeLog: [{ version: '1', date: '2026-10-01', author: 'А.И. Петров', description: 'Первая редакция' }],
  };
  const migrated = parseAnoPlanFile(legacy);
  assert.equal(migrated.kind, 'project');
  if (migrated.kind !== 'project') return;
  assert.equal(migrated.project.schemaVersion, 2);
  assert.equal(migrated.project.document?.organization, 'ООО «Проект-Монтаж»');
  assert.equal(migrated.project.document?.title, 'Кабельный журнал');
  assert.equal(migrated.project.document?.changeLog?.length, 1);
  assert.equal(migrated.project.document?.changeLog?.[0].id, 'change-1');
});

test('parse: мусорные вложения отбрасываются, валидные сохраняются', () => {
  const file = {
    format: ANOOPLAN_FORMAT,
    formatVersion: ANOOPLAN_FORMAT_VERSION,
    project: project(),
    pdfs: [
      null, 'pdf', {}, { id: 'p0' }, { id: 'p1', name: '', dataBase64: 'AAAA' },
      { id: ' p1 ', name: ' plan.pdf ', dataBase64: 'AAAA' },
    ],
    photos: [
      null, { key: '', name: 'x.jpg', mime: 'image/png', dataBase64: 'AAAA' },
      { key: 'k1', name: 'f.jpg', mime: '', dataBase64: 'BBBB' },
    ],
    exportedAt: '2026-01-01T00:00:00.000Z',
  };
  const parsed = parseAnoPlanFile(file);
  assert.equal(parsed.kind, 'file');
  if (parsed.kind !== 'file') return;
  assert.deepEqual(parsed.pdfs, [{ id: 'p1', name: 'plan.pdf', dataBase64: 'AAAA' }]);
  assert.deepEqual(parsed.photos, [{ key: 'k1', name: 'f.jpg', mime: 'image/jpeg', dataBase64: 'BBBB' }], 'пустой mime заменяется на image/jpeg');
});

test('parse: невалидные файлы дают ProjectSchemaError', () => {
  const invalid: unknown[] = [
    null, undefined, 'строка', 42, [], {},
    { format: ANOOPLAN_FORMAT },
    { format: ANOOPLAN_FORMAT, project: null },
    { format: ANOOPLAN_FORMAT, project: 'x' },
    { foo: 'bar' },
  ];
  for (const input of invalid) {
    assert.throws(() => parseAnoPlanFile(input), (error: unknown) => error instanceof ProjectSchemaError, `вход ${JSON.stringify(input)}`);
  }
  // Ошибки миграции проекта пробрасываются как есть.
  assert.throws(
    () => parseAnoPlanFile({ format: ANOOPLAN_FORMAT, project: { id: 'p' } }),
    (error: unknown) => error instanceof ProjectSchemaError && /обязательные списки/.test(error.message),
  );
  assert.throws(
    () => parseAnoPlanFile({ project: { schemaVersion: 99, id: 'p', floors: [] } }),
    (error: unknown) => error instanceof ProjectSchemaError && /более новой версией/.test(error.message),
  );
});

test('parse: проект из файла нормализуется миграциями', () => {
  const source = createDemoProject();
  const raw = JSON.parse(JSON.stringify(buildAnoPlanFile(source))) as Record<string, unknown>;
  const rawProject = raw.project as Record<string, unknown>;
  rawProject.catalog = 'мусор';
  (rawProject.document as Record<string, unknown>).changeLog = [null, { version: 2 }];
  const parsed = parseAnoPlanFile(raw);
  assert.equal(parsed.kind, 'file');
  if (parsed.kind !== 'file') return;
  assert.deepEqual(parsed.project.catalog, [], 'мусорный каталог нормализован');
  assert.equal(parsed.project.document?.changeLog, undefined, 'мусорный лист изменений отброшен');
});

test('assertProject принимает проект из .anooplan с документом и изменениями', () => {
  const parsed = parseAnoPlanFile(buildAnoPlanFile(createDemoProject()));
  assert.doesNotThrow(() => assertProject(parsed.project, () => true));
  const bare = parseAnoPlanFile(project());
  assert.doesNotThrow(() => assertProject(bare.project, () => true), 'старый проект без документа валиден');
});

const rejectsProject = (input: unknown, pattern: RegExp) => {
  assert.throws(
    () => assertProject(input, () => true),
    (error: unknown) => error instanceof ApiError && error.status === 422 && pattern.test(error.message),
  );
};

test('assertProject отклоняет мусор в document/changeLog с 422', () => {
  const base = createDemoProject();

  const badChangeLog = JSON.parse(JSON.stringify(base)) as Record<string, any>;
  badChangeLog.document.changeLog = 'нет';
  rejectsProject(badChangeLog, /project\.document\.changeLog: некорректная запись/);

  const nonObjectEntry = JSON.parse(JSON.stringify(base)) as Record<string, any>;
  nonObjectEntry.document.changeLog = [null];
  rejectsProject(nonObjectEntry, /project\.document\.changeLog: некорректная запись/);

  const missingFields = JSON.parse(JSON.stringify(base)) as Record<string, any>;
  missingFields.document.changeLog = [{ version: '1' }];
  rejectsProject(missingFields, /project\.document\.changeLog: некорректная запись/);

  const badField = JSON.parse(JSON.stringify(base)) as Record<string, any>;
  badField.document.changeLog = [{ id: 'c1', version: '1', date: '2026-10-01', author: 'А', description: 5 }];
  rejectsProject(badField, /project\.document\.changeLog: некорректная запись/);

  const badOrganization = JSON.parse(JSON.stringify(base)) as Record<string, any>;
  badOrganization.document.organization = 5;
  rejectsProject(badOrganization, /project\.document\.organization: некорректная строка/);

  const badDocument = JSON.parse(JSON.stringify(base)) as Record<string, any>;
  badDocument.document = 'документ';
  rejectsProject(badDocument, /project\.document: ожидается объект/);
});

test('migrateProject нормализует проект из .anooplan так же, как обычный проект', () => {
  const source = createDemoProject();
  const parsed = parseAnoPlanFile(buildAnoPlanFile(source));
  const migrated = migrateProject((parsed.project as unknown as Record<string, unknown>));
  assert.equal(migrated.id, source.id);
  assert.deepEqual(migrated.document, source.document);
  assert.equal(migrated.schemaVersion, 2);
});

test('формат новее поддерживаемого отклоняется понятной ошибкой', () => {
  const base = buildAnoPlanFile(project(), PDFS, PHOTOS);
  const future = { ...JSON.parse(serializeAnoPlanFile(base)), formatVersion: ANOOPLAN_FORMAT_VERSION + 1 };
  assert.throws(() => parseAnoPlanFile(future), (error: unknown) =>
    error instanceof ProjectSchemaError && /более новой версией/.test(error.message));
  // Текущая версия формата и её отсутствие (legacy) по-прежнему принимаются.
  assert.equal(parseAnoPlanFile(base).kind, 'file');
  const legacy = { ...JSON.parse(serializeAnoPlanFile(base)) };
  delete legacy.formatVersion;
  assert.equal(parseAnoPlanFile(legacy).kind, 'file');
});
