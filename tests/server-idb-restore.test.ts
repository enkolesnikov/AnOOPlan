import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { createApp } from '../server/app.js';
import type { Project } from '../src/model.js';

const pdf = Buffer.from('%PDF-1.4\n% idb restore fixture\n%%EOF');

function fixture(pdfId?: string): Project {
  return {
    schemaVersion: 2, id: 'project-1', name: 'Восстановление', updatedAt: '2026-01-01T00:00:00.000Z',
    floors: [{ id: 'floor-1', name: 'Первый этаж', elevation: 0, metersPerUnit: 1, page: 1, width: 100, height: 100, ...(pdfId ? { pdfId } : {}) }],
    equipment: [],
    routes: [],
    pins: [],
    cables: [],
  };
}

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), 'anooplan-idb-restore-'));
  const app = createApp({ dataDir: dir });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    request: (path: string, method = 'GET', body?: unknown) => fetch(base + path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      app.locals.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const manifestFor = (id: string) => ({
  version: 1,
  files: [{ kind: 'pdf', id, size: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex') }],
});

const backupWith = (id: string) => ({
  schemaVersion: 2,
  project: fixture(id),
  pdfs: [{ id, name: 'plan.pdf', dataBase64: pdf.toString('base64') }],
  photos: [],
  manifest: manifestFor(id),
});

test('restore: PDF из IndexedDB сохраняется под серверным id, ссылка этажа переписана', async () => {
  const h = await harness();
  try {
    const original = 'idb:11111111-1111-1111-1111-111111111111';
    const backup = backupWith(original);
    const response = await h.request('/api/restore', 'POST', backup);
    assert.equal(response.status, 201);
    const restored = await response.json() as Project;
    const newId = restored.floors[0].pdfId!;
    assert.ok(newId, 'у этажа потерян pdfId');
    assert.ok(!newId.startsWith('idb:'), `id не переписан на серверный: ${newId}`);

    const bytes = await h.request('/api/pdfs/' + encodeURIComponent(newId));
    assert.equal(bytes.status, 200, 'PDF не сохранён под новым id');
    assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), pdf);

    const stored = await (await h.request('/api/projects/project-1')).json() as Project;
    assert.equal(stored.floors[0].pdfId, newId, 'в сохранённом проекте остался исходный idb:-id');
  } finally { await h.close(); }
});

test('restore: манифест проверяется по исходным idb:-id до переименования', async () => {
  const h = await harness();
  try {
    const original = 'idb:22222222-2222-2222-2222-222222222222';
    const bad = backupWith(original);
    bad.manifest = { version: 1, files: [{ kind: 'pdf', id: original, size: 1, sha256: '0'.repeat(64) }] };
    assert.equal((await h.request('/api/restore', 'POST', bad)).status, 409);
    assert.equal((await h.request('/api/projects/project-1')).status, 404, 'битый restore не должен сохранять проект');

    assert.equal((await h.request('/api/restore', 'POST', backupWith(original))).status, 201);
  } finally { await h.close(); }
});

test('restore: обычные серверные id PDF не переименовываются', async () => {
  const h = await harness();
  try {
    const response = await h.request('/api/restore', 'POST', backupWith('pdf-1'));
    assert.equal(response.status, 201);
    const restored = await response.json() as Project;
    assert.equal(restored.floors[0].pdfId, 'pdf-1');
    const bytes = await h.request('/api/pdfs/pdf-1');
    assert.equal(bytes.status, 200);
    assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), pdf);
  } finally { await h.close(); }
});
