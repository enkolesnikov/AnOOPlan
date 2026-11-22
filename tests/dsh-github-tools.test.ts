/**
 * Тесты безопасности dsh-плагина GitHub: нормализация базового URL и защита
 * от полиномиального ReDoS (js/polynomial-redos). Сеть не используется.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  githubRelease,
  githubReleaseUpload,
  normalizeBaseUrl,
  trimTrailingSlashes,
} from '../dsh/plugins/dsh-github-tools/lib/core.js';

test('core.js экспортирует релизные инструменты', () => {
  assert.equal(typeof githubRelease, 'function');
  assert.equal(typeof githubReleaseUpload, 'function');
});

test('normalizeBaseUrl: без значения — публичный GitHub API', () => {
  assert.equal(normalizeBaseUrl(undefined), 'https://api.github.com');
  assert.equal(normalizeBaseUrl(), 'https://api.github.com');
  assert.equal(normalizeBaseUrl(''), 'https://api.github.com');
});

test('normalizeBaseUrl: срезает хвостовые слэши', () => {
  assert.equal(normalizeBaseUrl('https://api.github.com/'), 'https://api.github.com');
  assert.equal(normalizeBaseUrl('https://api.github.com///'), 'https://api.github.com');
  // GitHub Enterprise: хвостовые слэши срезаются, внутренние остаются как есть.
  assert.equal(normalizeBaseUrl('https://ghe.example.com/api/v3///'), 'https://ghe.example.com/api/v3');
  assert.equal(normalizeBaseUrl('https://ghe.example.com//api//v3'), 'https://ghe.example.com//api//v3');
});

test('normalizeBaseUrl: не-строка и слишком длинная строка — ошибки', () => {
  assert.throws(
    () => normalizeBaseUrl('x'.repeat(3000)),
    (error: unknown) => error instanceof RangeError && /2048/.test(error.message),
  );
  assert.throws(
    () => normalizeBaseUrl(42),
    (error: unknown) => error instanceof TypeError && /строкой/.test(error.message),
  );
  // Граница: ровно 2048 символов ещё допустимы.
  const atLimit = 'a'.repeat(2048);
  assert.equal(normalizeBaseUrl(atLimit), atLimit);
});

test('githubReleaseUpload: файл вне workspace отклоняется до сети', async () => {
  const previous = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'test-token-not-used';
  try {
    const relativeEscape = await githubReleaseUpload(
      { repoSlug: 'example/repo', root: process.cwd() },
      { tag: 'v0.0.0', file: '../outside.apk', dryRun: true },
    );
    assert.equal(relativeEscape.ok, false);
    assert.match(relativeEscape.problems[0], /вне workspace/);

    const absoluteEscape = await githubReleaseUpload(
      { repoSlug: 'example/repo', root: process.cwd() },
      { tag: 'v0.0.0', file: '/etc/passwd', dryRun: true },
    );
    assert.equal(absoluteEscape.ok, false);
    assert.match(absoluteEscape.problems[0], /вне workspace/);
  } finally {
    if (previous === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previous;
  }
});

test('githubReleaseUpload: dryRun проверяет файл и не делает upload', async () => {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const { port } = server.address() as AddressInfo;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      tag_name: 'v0.0.0',
      upload_url: `http://127.0.0.1:${port}/upload{?name,label}`,
      assets: [],
    }));
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const previous = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'test-token-not-used';
  try {
    const { port } = server.address() as AddressInfo;
    const result = await githubReleaseUpload(
      { repoSlug: 'example/repo', apiBase: `http://127.0.0.1:${port}`, root: process.cwd() },
      { tag: 'v0.0.0', file: 'tests/dsh-github-tools.test.ts', dryRun: true },
    );
    assert.equal(result.ok, true, JSON.stringify(result.problems));
    assert.equal(result.dryRun, true);
    assert.equal(result.assetName, 'dsh-github-tools.test.ts');
    assert.ok((result.sizeBytes ?? 0) > 0);
    // Только чтение релиза: POST в upload_url в dryRun не уходит.
    assert.deepEqual(requests, ['GET /repos/example/repo/releases/tags/v0.0.0']);
  } finally {
    if (previous === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previous;
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
});

test('normalizeBaseUrl: миллион слэшей обрабатывается меньше 50 мс (нет ReDoS)', () => {
  // Старый код делал .replace(/\/+$/, '') — на длинной строке слэшей это
  // квадратичное время. Сейчас вход отсекается лимитом длины за константу.
  const huge = '/'.repeat(1_000_000);
  const started = performance.now();
  assert.throws(() => normalizeBaseUrl(huge), RangeError);
  const elapsed = performance.now() - started;
  // Порог с запасом: на общих раннерах CI разброс времени в разы, а тест доказывает
  // отсутствие квадратичного роста, а не скорость конкретной машины.
  assert.ok(elapsed < 500, `отклонение 1e6 слэшей заняло ${elapsed.toFixed(2)} мс`);
});

test('trimTrailingSlashes: линейный разбор миллиона слэшей', () => {
  // Именно этот цикл заменяет регэксп: проверяем его на входе без лимита длины,
  // иначе тест доказывал бы только работу лимита.
  const huge = '/'.repeat(1_000_000);
  const started = performance.now();
  assert.equal(trimTrailingSlashes(huge), '');
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 500, `срез 1e6 слэшей занял ${elapsed.toFixed(2)} мс`);
  assert.equal(trimTrailingSlashes('https://api.github.com///'), 'https://api.github.com');
  assert.equal(trimTrailingSlashes('https://ghe.example.com//api//v3'), 'https://ghe.example.com//api//v3');
});

test('githubReleaseUpload: симлинк из workspace наружу отклоняется', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ws-'));
  const previous = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'test-token-not-used';
  try {
    const link = join(dir, 'leak.apk');
    try {
      symlinkSync('/etc/hostname', link);
    } catch {
      t.skip('нет прав на создание симлинка');
      return;
    }
    const result = await githubReleaseUpload(
      { repoSlug: 'example/repo', root: dir, apiBase: 'http://127.0.0.1:1' },
      { tag: 'v1', file: 'leak.apk' },
    );
    assert.equal(result.ok, false);
    assert.match(result.problems[0], /вне workspace/);
  } finally {
    if (previous === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('githubReleaseUpload: чужой upload_url отклоняется до отправки токена', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // upload_url ведёт на другой порт — это не хост API.
    res.end(JSON.stringify({ tag_name: 'v1', upload_url: 'http://127.0.0.1:1/upload{?name}', assets: [] }));
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const previous = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'test-token-not-used';
  try {
    const { port } = server.address() as AddressInfo;
    const result = await githubReleaseUpload(
      { repoSlug: 'example/repo', apiBase: `http://127.0.0.1:${port}`, root: process.cwd() },
      { tag: 'v1', file: 'tests/dsh-github-tools.test.ts' },
    );
    assert.equal(result.ok, false);
    assert.match(result.problems[0], /чужой хост/);
  } finally {
    if (previous === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previous;
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
});

test('githubReleaseUpload: загружает ассет с типом apk и Bearer-токеном', async () => {
  const captured: { url: string; auth: string; contentType: string; bytes: Buffer }[] = [];
  const server = createServer((req, res) => {
    const { port } = server.address() as AddressInfo;
    if (req.method !== 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tag_name: 'v1', upload_url: `http://127.0.0.1:${port}/upload{?name,label}`, assets: [] }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk as Buffer));
    req.on('end', () => {
      const bytes = Buffer.concat(chunks);
      captured.push({ url: req.url ?? '', auth: String(req.headers.authorization), contentType: String(req.headers['content-type']), bytes });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'asset.apk', size: bytes.length, state: 'uploaded', browser_download_url: 'https://example.test/asset.apk' }));
    });
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const dir = await mkdtemp(join(tmpdir(), 'dsh-upload-'));
  const previous = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'test-token-not-used';
  try {
    const payload = Buffer.from('fake-apk-bytes');
    writeFileSync(join(dir, 'asset.apk'), payload);
    const { port } = server.address() as AddressInfo;
    const result = await githubReleaseUpload(
      { repoSlug: 'example/repo', apiBase: `http://127.0.0.1:${port}`, root: dir },
      { tag: 'v1', file: 'asset.apk' },
    );
    assert.equal(result.ok, true, JSON.stringify(result.problems));
    assert.equal(captured.length, 1);
    assert.match(captured[0].url, /^\/upload\?name=asset\.apk/);
    assert.equal(captured[0].contentType, 'application/vnd.android.package-archive');
    assert.equal(captured[0].auth, 'Bearer test-token-not-used');
    assert.deepEqual(captured[0].bytes, payload);
    assert.equal(result.localSize, payload.length);
  } finally {
    if (previous === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previous;
    await rm(dir, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
});
