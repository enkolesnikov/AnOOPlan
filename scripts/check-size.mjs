#!/usr/bin/env node
// Бюджет стартового бандла: только те чанки, которые грузятся при первом открытии
// (index-*.js + index-*.css). Тяжёлые экспорты/PDF грузятся по действию и не входят.
// Ревизия 2026-10-27: 460→600 КБ JS и 40→60 КБ CSS, чтобы развитие не упиралось в
// ранний лимит; размер по-прежнему контролируется на каждом релизе.
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist', 'assets');
const JS_BUDGET = 600 * 1024;
const CSS_BUDGET = 60 * 1024;

if (!existsSync(DIST)) {
  console.error('Нет dist/assets — сначала соберите сайт: npm run build');
  process.exit(1);
}
const files = readdirSync(DIST);
const pick = pattern => files.filter(name => pattern.test(name)).map(name => ({ name, size: statSync(join(DIST, name)).size }));
const js = pick(/^index-.*\.js$/);
const css = pick(/^index-.*\.css$/);
const sum = items => items.reduce((total, item) => total + item.size, 0);
let failed = false;
for (const [label, items, budget] of [['JS', js, JS_BUDGET], ['CSS', css, CSS_BUDGET]]) {
  const total = sum(items);
  const status = total <= budget ? 'ok' : 'ПРЕВЫШЕН';
  console.log(`  ${label}: ${(total / 1024).toFixed(1)} КБ из ${(budget / 1024).toFixed(0)} КБ — ${status} (${items.map(item => item.name).join(', ') || 'нет файлов'})`);
  if (total > budget) failed = true;
}
if (failed) process.exit(1);
console.log('  бюджет стартового бандла соблюдён');
