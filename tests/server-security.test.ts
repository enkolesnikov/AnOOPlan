import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { createApp, type CreateAppOptions } from '../server/app.js';
import type { Project } from '../src/model.js';

const pdf = Buffer.from('%PDF-1.4\n% security fixtures\n%%EOF');
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function fixture(): Project {
  return {
    schemaVersion: 2, id: 'project-1', name: 'Безопасность', updatedAt: '2026-01-01T00:00:00.000Z',
    floors: [{ id: 'floor-1', name: 'Первый этаж', elevation: 0, metersPerUnit: 1, page: 1, width: 100, height: 100 }],
    equipment: [],
    routes: [],
    pins: [],
    cables: [],
  };
}

function fixtureWithPdf(id: string): Project {
  const project = fixture();
  project.floors[0].pdfId = id;
  return project;
}

async function harness(options: Omit<CreateAppOptions, 'dataDir'> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'anooplan-security-'));
  const app = createApp({ ...options, dataDir: dir });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolveListening => server.once('listening', resolveListening));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    request: (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(base + path, {
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    close: async () => {
      await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
      app.locals.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('rate limit /api: превышение даёт 429 и точное тело', async () => {
  const h = await harness({ rateLimits: { api: 3 } });
  try {
    for (let index = 0; index < 3; index += 1) {
      assert.equal((await h.request('/api/projects')).status, 200);
    }
    const limited = await h.request('/api/projects');
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: 'Слишком много запросов' });
  } finally { await h.close(); }
});

test('rate limit /api/restore: превышение даёт 429', async () => {
  const h = await harness({ rateLimits: { restore: 2 } });
  try {
    const backup = { schemaVersion: 1, project: fixture(), pdfs: [] };
    assert.equal((await h.request('/api/restore', 'POST', backup)).status, 201);
    assert.equal((await h.request('/api/restore', 'POST', backup)).status, 201);
    const limited = await h.request('/api/restore', 'POST', backup);
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: 'Слишком много запросов' });
  } finally { await h.close(); }
});

test('rate limit SPA-fallback: превышение даёт 429', async () => {
  // Свой dist: тест не зависит от того, собран ли бандл, и не флейкует при
  // параллельной сборке. Достаточно index.html — статику отдаёт express.static.
  const distDir = await mkdtemp(join(tmpdir(), 'anooplan-dist-'));
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>spa</title>');
  const h = await harness({ rateLimits: { spa: 2 }, distDir });
  try {
    const page = { Accept: 'text/html' };
    assert.equal((await h.request('/spa-fallback-route', 'GET', undefined, page)).status, 200);
    assert.equal((await h.request('/spa-fallback-route', 'GET', undefined, page)).status, 200);
    const limited = await h.request('/spa-fallback-route', 'GET', undefined, page);
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: 'Слишком много запросов' });
  } finally {
    await h.close();
    await rm(distDir, { recursive: true, force: true });
  }
});

test('restore: schemaVersion 2 без manifest отклоняется с 422', async () => {
  const h = await harness();
  try {
    const backup = { schemaVersion: 2, project: fixture(), pdfs: [], photos: [] };
    const response = await h.request('/api/restore', 'POST', backup);
    assert.equal(response.status, 422);
    const body = await response.json() as { error?: string };
    assert.match(body.error ?? '', /manifest/i);
    assert.equal((await h.request('/api/projects/project-1')).status, 404);
  } finally { await h.close(); }
});

test('restore: schemaVersion 2 с корректным manifest принимается', async () => {
  const h = await harness();
  try {
    const backup = { schemaVersion: 2, project: fixture(), pdfs: [], photos: [], manifest: { version: 1, files: [] } };
    assert.equal((await h.request('/api/restore', 'POST', backup)).status, 201);
    assert.equal((await h.request('/api/projects/project-1')).status, 200);
  } finally { await h.close(); }
});

test('restore: legacy schemaVersion 1 без manifest принимается', async () => {
  const h = await harness();
  try {
    const backup = { schemaVersion: 1, project: fixture(), pdfs: [] };
    assert.equal((await h.request('/api/restore', 'POST', backup)).status, 201);
    assert.equal((await h.request('/api/projects/project-1')).status, 200);
  } finally { await h.close(); }
});

test('restore: некорректная форма манифеста отклоняется с 422', async () => {
  const h = await harness();
  try {
    const backup = { schemaVersion: 2, project: fixture(), pdfs: [], photos: [], manifest: { version: 1, files: 'nope' } };
    const response = await h.request('/api/restore', 'POST', backup);
    assert.equal(response.status, 422);
    assert.match(((await response.json()) as { error: string }).error, /манифест/i);
  } finally { await h.close(); }
});

test('дефолтный лимит /api — 120 запросов в минуту', async () => {
  const h = await harness();
  try {
    const response = await h.request('/api/projects');
    assert.equal(response.status, 200);
    // Заголовки draft-7: политика содержит объявленный лимит.
    assert.match(response.headers.get('ratelimit-policy') ?? '', /120/);
    assert.match(response.headers.get('ratelimit') ?? '', /limit=120/);
  } finally { await h.close(); }
});

test('/api/health не расходует общий лимит', async () => {
  const h = await harness({ rateLimits: { api: 2 } });
  try {
    for (let index = 0; index < 5; index += 1) {
      assert.equal((await h.request('/api/health')).status, 200);
    }
  } finally { await h.close(); }
});

test('JSON-парсер не разбирает тела вне /api: POST на неизвестный путь — 404, не 400', async () => {
  const h = await harness();
  try {
    const response = await fetch(h.base + '/not-api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{broken',
    });
    assert.equal(response.status, 404);
  } finally { await h.close(); }
});

test('backup проекта с data:-подложкой не падает с 409', async () => {
  const h = await harness();
  try {
    const project = fixtureWithPdf('data:application/pdf;base64,AAAA');
    assert.equal((await h.request('/api/projects', 'POST', project)).status, 201);
    const backup = await h.request('/api/projects/project-1/backup');
    assert.equal(backup.status, 200);
    const body = await backup.json() as { pdfs: unknown[]; manifest: { files: unknown[] } };
    assert.deepEqual(body.pdfs, []);
    assert.deepEqual(body.manifest.files, []);
  } finally { await h.close(); }
});

test('backup отдаёт manifest, и копия восстанавливается в чистое приложение', async () => {
  const source = await harness();
  const target = await harness();
  try {
    const form = new FormData();
    form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'plan.pdf');
    const uploaded = await fetch(source.base + '/api/pdfs', { method: 'POST', body: form });
    assert.equal(uploaded.status, 201);
    const record = await uploaded.json() as { id: string; name: string };
    assert.equal((await source.request('/api/projects', 'POST', fixtureWithPdf(record.id))).status, 201);

    const backup = await (await source.request('/api/projects/project-1/backup')).json() as {
      schemaVersion: number;
      pdfs: { id: string; dataBase64: string }[];
      manifest: { version: number; files: { kind: string; id: string; size: number; sha256: string }[] };
    };
    assert.equal(backup.schemaVersion, 2);
    assert.deepEqual(backup.manifest, {
      version: 1,
      files: [{ kind: 'pdf', id: record.id, size: pdf.length, sha256: sha256(pdf) }],
    });

    assert.equal((await target.request('/api/restore', 'POST', backup)).status, 201);
    const restored = await target.request('/api/pdfs/' + encodeURIComponent(record.id));
    assert.equal(restored.status, 200);
    assert.deepEqual(Buffer.from(await restored.arrayBuffer()), pdf);
  } finally { await source.close(); await target.close(); }
});
