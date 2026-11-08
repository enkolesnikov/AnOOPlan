#!/usr/bin/env node
/** Проверяет секреты в отслеживаемых файлах и в индексе перед коммитом. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const staged = process.argv.includes('--staged');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
process.chdir(root);

const patterns = [
  ['github_pat', /github_pat_[A-Za-z0-9_]{20,}/],
  ['github_token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['aws_access_key', /\bAKIA[0-9A-Z]{16}\b/],
  ['google_api_key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['openai_key', /\bsk-[A-Za-z0-9]{20,}\b/],
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['slack_token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['secret_assignment', /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']([^"']{8,})["']/i],
];
const sensitiveName = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|jks|keystore)|id_(rsa|ed25519)|keystore\.properties|credentials(\..*)?|secrets?(\..*)?)$/i;
const skipExtension = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.zip', '.apk', '.aab', '.pdf', '.xlsx', '.jar']);

function gitFiles() {
  const args = staged
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR']
    : ['ls-files'];
  return execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
}
function content(file) {
  if (staged) return execFileSync('git', ['show', `:${file}`], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return readFileSync(file, 'utf8');
}

const findings = [];
for (const file of gitFiles()) {
  if (sensitiveName.test(file)) findings.push(`${file}: секретное имя файла`);
  if (skipExtension.has(extname(file).toLowerCase())) continue;
  let text;
  try { text = content(file); } catch { continue; }
  if (text.includes('\0')) continue;
  text.split('\n').forEach((line, index) => {
    for (const [name, pattern] of patterns) {
      if (pattern.test(line)) findings.push(`${file}:${index + 1}: ${name}`);
    }
  });
}
if (findings.length) {
  console.error('Найдены потенциальные секреты:\n' + findings.map(f => `- ${f}`).join('\n'));
  console.error('Удалите секрет из файла, отзовите ключ и очистите историю. Значения в вывод не печатаются.');
  process.exit(1);
}
console.log(`Секретов не найдено (${staged ? 'индекс' : 'отслеживаемые файлы'}, ${gitFiles().length}).`);
