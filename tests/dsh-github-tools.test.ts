/**
 * Тесты безопасности dsh-плагина GitHub: нормализация базового URL и защита
 * от полиномиального ReDoS (js/polynomial-redos). Сеть не используется.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  githubRelease,
  githubReleaseUpload,
  normalizeBaseUrl,
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
  assert.ok(elapsed < 50, `отклонение 1e6 слэшей заняло ${elapsed.toFixed(2)} мс`);

  // Линейность самого цикла среза на максимально допустимом входе.
  const longTail = `${'a'.repeat(2044)}////`;
  const trimStarted = performance.now();
  assert.equal(normalizeBaseUrl(longTail).length, 2044);
  const trimElapsed = performance.now() - trimStarted;
  assert.ok(trimElapsed < 50, `срез 4 хвостовых слэшей занял ${trimElapsed.toFixed(2)} мс`);
});
