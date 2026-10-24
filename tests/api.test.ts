import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
import type { Project } from '../src/model.js';

const originalPdf = Buffer.from('%PDF-1.4\n% synthetic integration fixture\n%%EOF');
function fixture(): Project {
  return {
    schemaVersion: 2, id: 'project-1', name: 'Синтетический тест', updatedAt: '2025-01-01T00:00:00.000Z',
    floors: [{ id: 'floor-1', name: 'Первый этаж', elevation: 0, metersPerUnit: 1, page: 1, width: 100, height: 100 }],
    equipment: [
      { id: 'equipment-1', number: 'Ш1', name: 'Щит', type: 'Щит', floorId: 'floor-1', x: 0, y: 0, height: 0, note: '', properties: {} },
      { id: 'equipment-2', number: 'П1', name: 'Прибор', type: 'Прибор', floorId: 'floor-1', x: 3, y: 0, height: 0, note: '', properties: {} },
    ],
    routes: [{ id: 'route-1', number: 'Т1', type: 'Лоток', note: '', segments: [{ id: 'segment-1', a: { id: 'v1', floorId: 'floor-1', x: 0, y: 0, height: 0 }, b: { id: 'v2', floorId: 'floor-1', x: 3, y: 0, height: 0 }, mode: 'orthogonal', reservePercent: 0, reserveFixed: 0 }] }],
    pins: [],
    cables: [{ id: 'cable-1', number: 'К1', name: 'Кабель', brand: 'ВВГ', purpose: 'Питание', fromId: 'equipment-1', toId: 'equipment-2', segmentIds: ['segment-1'], reservePercent: 0, reserveFixed: 0, startReserve: 0, endReserve: 0, quantity: 2, note: '' }],
  };
}
async function harness() {
  const dir = await mkdtemp(join(tmpdir(), 'ooplan-api-'));
  const app = createApp({ dataDir: dir });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base, app, dir,
    request: (path: string, method = 'GET', body?: unknown) => fetch(base + path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }),
    close: async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); app.locals.close(); await rm(dir, { recursive: true, force: true }); },
  };
}

test('CRUD persists across app restart; failed PUT leaves previous data', async () => {
  const h = await harness();
  try {
    assert.deepEqual(await (await h.request('/api/health')).json(), { ok: true });
    assert.equal((await h.request('/api/projects/missing')).status, 404);
    const created = await h.request('/api/projects', 'POST', fixture()); assert.equal(created.status, 201);
    assert.equal((await h.request('/api/projects', 'POST', fixture())).status, 409);
    assert.equal((await (await h.request('/api/projects')).json()).length, 1);
    const p = fixture(); p.name = 'Изменённый';
    assert.equal((await h.request('/api/projects/project-1', 'PUT', p)).status, 200);
    p.cables[0].toId = 'missing';
    assert.equal((await h.request('/api/projects/project-1', 'PUT', p)).status, 422);
    assert.equal((await (await h.request('/api/projects/project-1')).json()).name, 'Изменённый');
    const second = createApp({ dataDir: h.dir });
    try { assert.equal(second.locals.store.project('project-1').name, 'Изменённый'); } finally { second.locals.close(); }
  } finally { await h.close(); }
});

test('engineering incompleteness is saved; malformed structure, references and duplicate IDs are rejected', async () => {
  const h = await harness();
  try {
    const p = fixture(); p.floors[0].metersPerUnit = null; p.equipment[0].height = null;
    const response = await h.request('/api/projects', 'POST', p); assert.equal(response.status, 201); assert.ok(Number(response.headers.get('x-project-warnings')) > 0);
    const cases: Array<(p: Project) => void> = [
      p => { p.equipment[1].id = p.equipment[0].id; },
      p => { p.equipment[1].number = p.equipment[0].number; },
      p => { p.cables[0].segmentIds = ['missing']; },
      p => { p.cables[0].segmentIds = ['segment-1', 'segment-1']; },
      p => { p.equipment[0].floorId = 'missing'; },
      p => { p.floors[0].pdfId = 'missing'; },
      p => { p.cables[0].quantity = -1; },
      p => { p.routes[0].segments[0].b.id = 'v1'; },
      p => { const pin = { id: 'pin-1', number: 'З-1', floorId: 'floor-1', x: 0, y: 0, comment: '', status: 'open' as const, photos: [], createdAt: '', updatedAt: '' }; p.pins = [pin, { ...pin, id: 'pin-2' }]; },
    ];
    for (const mutate of cases) { const invalid = fixture(); mutate(invalid); assert.equal((await h.request('/api/projects/project-1', 'PUT', invalid)).status, 422); }
    assert.equal((await h.request('/api/projects/project-1', 'PUT', { ...fixture(), id: 'other' })).status, 422);
    assert.equal((await h.request('/api/projects/project-1', 'PUT', { id: 'project-1' })).status, 422);
  } finally { await h.close(); }
});

test('необязательные размеры кабеля и лотка сохраняются, а неверные значения отклоняются', async () => {
  const h = await harness();
  try {
    const p = fixture();
    p.cables[0].outerDiameterMm = 6;
    p.routes[0].trayWidthMm = 100;
    p.routes[0].trayHeightMm = 50;
    assert.equal((await h.request('/api/projects', 'POST', p)).status, 201);
    const stored = await (await h.request('/api/projects/project-1')).json() as Project;
    assert.equal(stored.cables[0].outerDiameterMm, 6);
    assert.equal(stored.cables[0].crossSectionMm2, undefined, 'отсутствующее сечение остаётся неизвестным');
    assert.equal(stored.routes[0].trayWidthMm, 100);
    assert.equal(stored.routes[0].trayHeightMm, 50);
    assert.equal(stored.routes[0].trayAreaMm2, undefined, 'отсутствующая площадь лотка остаётся неизвестной');

    const invalid: Array<(project: Project) => void> = [
      project => { project.cables[0].outerDiameterMm = -1; },
      project => { project.cables[0].crossSectionMm2 = 0; },
      project => { project.routes[0].trayWidthMm = 0; },
      project => { project.routes[0].trayHeightMm = -5; },
      project => { project.routes[0].trayAreaMm2 = 0; },
    ];
    for (const mutate of invalid) {
      const bad = fixture(); mutate(bad);
      assert.equal((await h.request('/api/projects/project-1', 'PUT', bad)).status, 422);
    }
    const badPost = fixture(); badPost.id = 'project-2'; badPost.cables[0].outerDiameterMm = -1;
    assert.equal((await h.request('/api/projects', 'POST', badPost)).status, 422);
    // Отклонённые PUT не испортили сохранённые данные.
    const after = await (await h.request('/api/projects/project-1')).json() as Project;
    assert.equal(after.cables[0].outerDiameterMm, 6);
  } finally { await h.close(); }
});

test('цвет оборудования сохраняется, а неверный цвет отклоняется с 422', async () => {
  const h = await harness();
  try {
    const p = fixture();
    p.equipment[0].color = '#AABBCC';
    assert.equal((await h.request('/api/projects', 'POST', p)).status, 201);
    const stored = await (await h.request('/api/projects/project-1')).json() as Project;
    assert.ok(stored.equipment[0].color, 'цвет оборудования должен сохраниться');
    assert.equal(String(stored.equipment[0].color).toLowerCase(), '#aabbcc');
    assert.equal(stored.equipment[1].color, undefined, 'оборудование без цвета не получает дефолт');

    // Валидный короткий цвет принимается.
    const short = fixture();
    short.id = 'project-2';
    short.equipment[1].color = '#ABC';
    assert.equal((await h.request('/api/projects', 'POST', short)).status, 201);

    const invalid: Array<(project: Project) => void> = [
      project => { project.equipment[0].color = 'red'; },
      project => { project.equipment[0].color = '#12'; },
      project => { project.equipment[1].color = ''; },
    ];
    for (const mutate of invalid) {
      const bad = fixture(); mutate(bad);
      assert.equal((await h.request('/api/projects/project-1', 'PUT', bad)).status, 422);
    }

    const badPost = fixture(); badPost.id = 'project-3'; badPost.equipment[0].color = 'red';
    const rejected = await h.request('/api/projects', 'POST', badPost);
    assert.equal(rejected.status, 422);
    assert.match((await rejected.json()).error, /equipment\.color/);

    // Отклонённые PUT не испортили сохранённый цвет.
    const after = await (await h.request('/api/projects/project-1')).json() as Project;
    assert.equal(String(after.equipment[0].color).toLowerCase(), '#aabbcc');
  } finally { await h.close(); }
});

test('цвет трассы КНС сохраняется и валидируется', async () => {
  const h = await harness();
  try {
    const p = fixture();
    p.routes[0].color = '#ABC';
    assert.equal((await h.request('/api/projects', 'POST', p)).status, 201);
    const stored = await (await h.request('/api/projects/project-1')).json() as Project;
    assert.equal(String(stored.routes[0].color).toLowerCase(), '#abc');

    const short = fixture();
    short.id = 'project-2';
    short.routes[0].color = '#00ff00';
    assert.equal((await h.request('/api/projects', 'POST', short)).status, 201);

    const invalid: Array<(project: Project) => void> = [
      project => { project.routes[0].color = 'red'; },
      project => { project.routes[0].color = '#12'; },
      project => { project.routes[0].color = ''; },
    ];
    for (const mutate of invalid) {
      const bad = fixture(); mutate(bad);
      const response = await h.request('/api/projects/project-1', 'PUT', bad);
      assert.equal(response.status, 422);
    }
    const rejected = await h.request('/api/projects/project-1', 'PUT', { ...fixture(), routes: [{ ...fixture().routes[0], color: 'red' }] });
    assert.equal(rejected.status, 422);
    assert.match((await rejected.json()).error, /route\.color/);

    const after = await (await h.request('/api/projects/project-1')).json() as Project;
    assert.equal(String(after.routes[0].color).toLowerCase(), '#abc', 'отклонённый PUT не испортил цвет');
  } finally { await h.close(); }
});

test('PDF multipart and portable backup restore preserve original bytes; restore is atomic', async () => {
  const a = await harness(); const b = await harness();
  try {
    const form = new FormData(); form.append('file', new Blob([originalPdf], { type: 'application/pdf' }), 'plan.pdf');
    const uploaded = await fetch(a.base + '/api/pdfs', { method: 'POST', body: form }); assert.equal(uploaded.status, 201);
    const record = await uploaded.json() as { id: string; name: string };
    const p = fixture(); p.floors[0].pdfId = record.id;
    assert.equal((await a.request('/api/projects', 'POST', p)).status, 201);
    const backup = await (await a.request('/api/projects/project-1/backup')).json();
    assert.equal(backup.pdfs[0].dataBase64, originalPdf.toString('base64'));
    const broken = structuredClone(backup); broken.project.cables[0].fromId = 'missing';
    assert.equal((await b.request('/api/restore', 'POST', broken)).status, 422);
    assert.equal((await b.request('/api/pdfs/' + record.id)).status, 404);
    assert.equal((await b.request('/api/restore', 'POST', backup)).status, 201);
    assert.deepEqual(Buffer.from(await (await b.request('/api/pdfs/' + record.id)).arrayBuffer()), originalPdf);
    assert.equal((await b.request('/api/restore', 'POST', backup)).status, 201);
    const invalid = new FormData(); invalid.append('file', new Blob(['not a PDF']), 'bad.pdf');
    assert.equal((await fetch(a.base + '/api/pdfs', { method: 'POST', body: invalid })).status, 422);
    const conflict = structuredClone(backup); conflict.project.id = 'different'; conflict.pdfs[0].name = 'different.pdf';
    assert.equal((await b.request('/api/restore', 'POST', conflict)).status, 409);
    assert.equal((await b.request('/api/projects/different')).status, 404);
  } finally { await a.close(); await b.close(); }
});

test('DELETE удаляет проект из хранилища', async () => {
  const h = await harness();
  try {
    assert.equal((await h.request('/api/projects', 'POST', fixture())).status, 201);
    assert.equal((await h.request('/api/projects/project-1', 'DELETE')).status, 200);
    assert.equal((await h.request('/api/projects/project-1')).status, 404);
    assert.equal((await (await h.request('/api/projects')).json()).length, 0);
    assert.equal((await h.request('/api/projects/project-1', 'DELETE')).status, 404);
  } finally { await h.close(); }
});

test('DELETE удаляет осиротевшие PDF, но сохраняет используемые', async () => {
  const h = await harness();
  try {
    const form = new FormData(); form.append('file', new Blob([originalPdf], { type: 'application/pdf' }), 'plan.pdf');
    const uploaded = await fetch(h.base + '/api/pdfs', { method: 'POST', body: form });
    const record = await uploaded.json() as { id: string; name: string };
    const p = fixture(); p.floors[0].pdfId = record.id;
    assert.equal((await h.request('/api/projects', 'POST', p)).status, 201);
    assert.equal((await h.request('/api/pdfs/' + record.id)).status, 200);
    assert.equal((await h.request('/api/projects/project-1', 'DELETE')).status, 200);
    assert.equal((await h.request('/api/pdfs/' + record.id)).status, 404);
  } finally { await h.close(); }
});

test('повтор имени оборудования отклоняется', async () => {
  const h = await harness();
  try {
    const p = fixture(); p.equipment[1].name = p.equipment[0].name;
    assert.equal((await h.request('/api/projects', 'POST', p)).status, 422);
  } finally { await h.close(); }
});
