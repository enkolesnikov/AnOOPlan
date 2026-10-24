#!/usr/bin/env node
// Быстрый статус проекта вместо ручной синхронизации счётчиков в документации.
// npm run status       — версии, git, размеры, уязвимости, ориентировочные счётчики;
// npm run status:full  — плюс реальный прогон тестов, смоука и E2E.
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const full = process.argv.includes('--full');

const run = (cmd, args, options = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...options });
const countMatches = (dir, pattern) => {
  let total = 0;
  for (const name of readdirSync(join(ROOT, dir))) {
    if (!name.endsWith('.test.ts') && !name.endsWith('.spec.ts')) continue;
    const text = readFileSync(join(ROOT, dir, name), 'utf8');
    total += (text.match(pattern) || []).length;
  }
  return total;
};
const sizeOf = path => (existsSync(path) ? `${(statSync(path).size / 1024).toFixed(1)} КБ` : '—');
const dirSize = dir => {
  const target = join(ROOT, dir);
  if (!existsSync(target)) return '—';
  // Без shell: аргументы передаются списком, путь из репозитория не может стать командой.
  const result = spawnSync('du', ['-sh', target], { encoding: 'utf8' });
  if (result.status !== 0) return '—';
  return (result.stdout || '').split('\t')[0] || '—';
};

console.log(`AnOOPlan ${pkg.version} (androidVersionCode ${pkg.androidVersionCode})`);
const git = run('git', ['log', '-1', '--format=%h %s']);
console.log(`git: ${(git.stdout || '').trim()}`);
const status = run('git', ['status', '--porcelain']);
console.log(`рабочее дерево: ${(status.stdout || '').trim() ? 'есть незакоммиченные изменения' : 'чисто'}`);
console.log(`ориентировочно: тестов ~${countMatches('tests', /^test\(/gm)}, E2E ~${countMatches('tests/e2e', /^test\(/gm)}, проверок смоука ~${(readFileSync(join(ROOT, 'scripts/smoke-dom.mjs'), 'utf8').match(/check\(/g) || []).length}`);
console.log(`dist: JS ${sizeOf(join(ROOT, 'dist/assets', (readdirSync(join(ROOT, 'dist/assets')).find(name => /^index-.*\.js$/.test(name)) || '')))}`);
const apks = existsSync(join(ROOT, 'build')) ? readdirSync(join(ROOT, 'build')).filter(name => name.endsWith('.apk')) : [];
const currentApk = `AnOOPlan-${pkg.version}.apk`;
const shown = apks.includes(currentApk) ? [currentApk] : apks.slice(-1);
console.log(`APK: ${shown.length ? shown.map(name => `${name} ${(statSync(join(ROOT, 'build', name)).size / 1024 / 1024).toFixed(2)} МБ`).join(', ') : '—'}${apks.length > shown.length ? ` (всего в build/: ${apks.length})` : ''}`);
console.log(`node_modules: ${dirSize('node_modules')}`);
const audit = run('npm', ['audit', '--json']);
try {
  const report = JSON.parse(audit.stdout || '{}');
  const vulns = report.metadata?.vulnerabilities ?? {};
  console.log(`npm audit: high ${vulns.high ?? 0}, critical ${vulns.critical ?? 0}, всего ${Object.values(vulns).reduce((a, b) => a + b, 0)}`);
} catch {
  console.log('npm audit: не удалось прочитать отчёт');
}

if (full) {
  for (const [label, args] of [['тесты', ['test']], ['смоук', ['run', 'smoke']], ['E2E', ['run', 'test:ui']]]) {
    console.log(`\n== ${label} ==`);
    const result = run('npm', args, { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
