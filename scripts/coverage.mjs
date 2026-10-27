#!/usr/bin/env node
// Юнит-тесты с покрытием и порогами (без новых зависимостей: node --experimental-test-coverage).
// Порог чуть ниже текущего уровня, чтобы падать только на реальной регрессии.
// Дополнительно пишем coverage/lcov.info (встроенный lcov-reporter Node 24) — его
// загружает Codacy в CI, чтобы в отчёте было реальное покрытие, а не «не загружено».
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/** Все исходники src/ и физические строки — чтобы показать охват, а не только lcov-файлы. */
function sourceFiles(dir = join(ROOT, 'src')) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}
const COVERAGE_DIR = join(ROOT, 'coverage');
const LCOV_PATH = join(COVERAGE_DIR, 'lcov.info');
const files = readdirSync(join(ROOT, 'tests')).filter(name => name.endsWith('.test.ts')).map(name => join('tests', name));
const THRESHOLDS = { lines: 93, branches: 85, functions: 92 };
mkdirSync(COVERAGE_DIR, { recursive: true });
const result = spawnSync('npx', [
  'tsx', '--test', '--experimental-test-coverage',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=lcov', `--test-reporter-destination=${LCOV_PATH}`,
  ...files,
], {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' },
});
const output = `${result.stdout || ''}${result.stderr || ''}`;
process.stdout.write(output.split('\n').filter(line => /tests |pass |fail |all files/.test(line)).join('\n') + '\n');
if (result.status !== 0) {
  console.error('Юнит-тесты завершились с ошибкой');
  process.exit(result.status ?? 1);
}
let lcov = '';
try {
  lcov = readFileSync(LCOV_PATH, 'utf8');
} catch {
  console.error(`Не создан lcov-отчёт: ${LCOV_PATH}`);
  process.exit(1);
}
if (!lcov.includes('SF:') || !lcov.includes('DA:')) {
  console.error('lcov-отчёт пуст: нет записей SF/DA');
  process.exit(1);
}
console.log(`  lcov: ${LCOV_PATH} (${(statSync(LCOV_PATH).size / 1024).toFixed(1)} КБ)`);
const summary = output.split('\n').find(line => line.includes('all files'));
const numbers = (summary || '').split('|').map(part => parseFloat(part.trim())).filter(value => Number.isFinite(value));
if (numbers.length < 3) {
  console.error('Не удалось разобрать отчёт покрытия');
  process.exit(1);
}
const [lines, branches, functions] = numbers;
// Вторая, честная цифра: lcov видит только импортированные тестами модули, а src/ui/
// и часть хуков в юнит-тесты не входят. Печатаем охват по всем src/, но порог пока
// применяем к тестируемым модулям (переход на полный порог — отдельная задача).
const srcFiles = sourceFiles();
const totalSrcLines = srcFiles.reduce((sum, file) => sum + readFileSync(file, 'utf8').split('\n').length, 0);
const coveredSrc = new Set([...lcov.matchAll(/^SF:(.*)$/gm)].map(match => match[1].replace(/.*Anooplan\//, '')));
let hitSrcLines = 0;
for (const block of lcov.split('end_of_record')) {
  const sf = /^SF:(.*)$/m.exec(block);
  if (!sf || !coveredSrc.has(sf[1].replace(/.*Anooplan\//, ''))) continue;
  const lh = /^LH:(\d+)$/m.exec(block);
  if (lh) hitSrcLines += Number(lh[1]);
}
const allRatio = totalSrcLines ? hitSrcLines / totalSrcLines * 100 : 0;
console.log(`  охват всех src/: ${allRatio.toFixed(1)}% (${hitSrcLines}/${totalSrcLines} строк; ${coveredSrc.size}/${srcFiles.length} файлов)`);
let failed = false;
for (const [name, value, threshold] of [['строки', lines, THRESHOLDS.lines], ['ветки', branches, THRESHOLDS.branches], ['функции', functions, THRESHOLDS.functions]]) {
  const ok = value >= threshold;
  console.log(`  покрытие ${name}: ${value.toFixed(1)}% (порог ${threshold}%) — ${ok ? 'ok' : 'НИЖЕ ПОРОГА'}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
