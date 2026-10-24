#!/usr/bin/env node
// Юнит-тесты с покрытием и порогами (без новых зависимостей: node --experimental-test-coverage).
// Порог чуть ниже текущего уровня, чтобы падать только на реальной регрессии.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const files = readdirSync(join(ROOT, 'tests')).filter(name => name.endsWith('.test.ts')).map(name => join('tests', name));
const THRESHOLDS = { lines: 93, branches: 85, functions: 92 };
const result = spawnSync('npx', ['tsx', '--test', '--experimental-test-coverage', ...files], {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' },
});
const output = `${result.stdout || ''}${result.stderr || ''}`;
process.stdout.write(output.split('\n').filter(line => /tests |pass |fail |all files/.test(line)).join('\n') + '\n');
if (result.status !== 0) {
  console.error('Юнит-тесты завершились с ошибкой');
  process.exit(result.status ?? 1);
}
const summary = output.split('\n').find(line => line.includes('all files'));
const numbers = (summary || '').split('|').map(part => parseFloat(part.trim())).filter(value => Number.isFinite(value));
if (numbers.length < 3) {
  console.error('Не удалось разобрать отчёт покрытия');
  process.exit(1);
}
const [lines, branches, functions] = numbers;
let failed = false;
for (const [name, value, threshold] of [['строки', lines, THRESHOLDS.lines], ['ветки', branches, THRESHOLDS.branches], ['функции', functions, THRESHOLDS.functions]]) {
  const ok = value >= threshold;
  console.log(`  покрытие ${name}: ${value.toFixed(1)}% (порог ${threshold}%) — ${ok ? 'ok' : 'НИЖЕ ПОРОГА'}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
