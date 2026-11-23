import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSizeInfo, runtimeReportLines, webViewVersion, type RuntimeReport } from '../src/runtime-info';
import { baseProject, device, route, cable } from './fixtures';

test('версия WebView распознаётся из User-Agent', () => {
  assert.equal(
    webViewVersion('Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP31.240617.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/137.0.7151.61 Mobile Safari/537.36'),
    'WebView 137',
  );
  assert.equal(
    webViewVersion('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'),
    'Chrome 141',
  );
  assert.equal(
    webViewVersion('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'),
    'Safari 17',
  );
  assert.equal(webViewVersion('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'), 'Firefox 130');
  assert.equal(webViewVersion(''), 'неизвестно');
  assert.equal(webViewVersion('абракадабра'), 'неизвестно');
});

test('размер проекта считает байты JSON и счётчики объектов', () => {
  const project = baseProject({
    equipment: [device('e1', 0), device('e2', 1)],
    routes: [route('r1', [])],
    cables: [cable({ id: 'c1', fromId: 'e1', toId: 'e2' })],
  });
  const info = projectSizeInfo(project);
  assert.ok(info.bytes > 100, `JSON проекта непустой (${info.bytes} Б)`);
  assert.equal(info.equipment, 2);
  assert.equal(info.routes, 1);
  assert.equal(info.cables, 1);
  assert.equal(info.pins, 0);
});

test('строки отчёта содержат WebView, хранилище и размер проекта', () => {
  const report: RuntimeReport = {
    appVersion: '3.0.0',
    generatedAt: '2026-11-23T00:00:00.000Z',
    userAgent: 'UA-строка',
    webView: 'WebView 137',
    language: 'ru-RU',
    storage: { usage: 2 * 1024 * 1024, quota: 100 * 1024 * 1024, ratio: 0.02 },
    persisted: true,
    project: { bytes: 12_345, floors: 1, equipment: 10, routes: 5, cables: 7, pins: 2 },
  };
  const text = runtimeReportLines(report).join('\n');
  assert.match(text, /WebView 137/);
  assert.match(text, /занято 2\.0 МБ из 100\.0 МБ \(2%\)/);
  assert.match(text, /persist.*включено/);
  assert.match(text, /12\.1 КБ JSON/);
  assert.match(text, /оборуд\. 10/);
});

test('отчёт честно показывает недоступность оценки хранилища', () => {
  const report: RuntimeReport = {
    appVersion: '3.0.0',
    generatedAt: '2026-11-23T00:00:00.000Z',
    userAgent: '',
    webView: 'неизвестно',
    language: '',
    storage: null,
    persisted: null,
    project: { bytes: 0, floors: 0, equipment: 0, routes: 0, cables: 0, pins: 0 },
  };
  const text = runtimeReportLines(report).join('\n');
  assert.match(text, /оценка занятого места недоступна/);
  assert.doesNotMatch(text, /persist/, 'нет данных — нет строки о закреплении');
});
