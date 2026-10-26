/**
 * dsh-anooplan-tools — проектные проверки AnOOPlan для DSH.
 *
 * Только то, чего нет в общих плагинах:
 *   anooplan_apk_check    — статическая проверка подписанного APK;
 *   anooplan_visual_check — визуальные эталоны (npm run test:visual).
 *
 * Работа с устройством/эмулятором — в `dsh-android-tools`, релизы и активы
 * GitHub — в `dsh-github-tools` (дубли удалены в 0.2.0).
 *
 * @module dsh-anooplan-tools
 */
import { apkCheck, visualCheck } from './core.js';

export const name = 'dsh-anooplan-tools';
export const inject = ['tools'];

const DEFAULTS = {
  root: '/root/Anooplan',
  buildToolsDir: 'tools/build-tools/35.0.0',
  expectedCertSha256: '6431374cf6a7d385c4c47f0f2bf54fcb5ee5b2c7120f057b18c4062af92fe097',
  maxApkBytes: 1_600_000,
};

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { json: { type: 'string' }, markdown: { type: 'string' } },
    required: ['json', 'markdown'],
  },
  render: (_args, value) => [{ type: 'text', text: value.markdown || value.json }],
};

const list = (title, items) => [title, ...items.map(item => `- ${item}`)].join('\n');

function renderApk(result) {
  if (!result.apk) return list('APK: проверка не выполнена', result.problems);
  const checks = Object.entries(result.checks ?? {}).map(([key, ok]) => `${ok ? '✅' : '❌'} ${key}`);
  const body = [
    `APK: \`${result.apk}\``,
    `Версия: ${result.versionName} (versionCode ${result.versionCode})`,
    `Вес: ${result.sizeMB} МБ (${result.sizeBytes} Б)`,
    `Сертификат: ${result.certificateSha256 ?? '—'}`,
    `Разрешения: ${result.permissions.join(', ') || 'нет'}`,
    '',
    list('Проверки:', checks),
  ];
  if (result.problems.length > 0) body.push('', list('Проблемы:', result.problems));
  return body.join('\n');
}

function renderVisual(result) {
  const head = `Визуальные эталоны: ${result.ok ? 'успех' : 'провал'} · ${result.script} · ${result.durationSeconds} с`;
  return [head, ...(result.problems.length ? ['', list('Проблемы:', result.problems)] : []), '', '```', result.tail, '```'].join('\n');
}

/** Регистрирует проектные проверки AnOOPlan. */
export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config };

  ctx.tools.register({
    name: 'anooplan_apk_check',
    description: 'Static check of the latest signed AnOOPlan APK: version/versionCode against package.json and AndroidManifest, INTERNET permission, signing certificate SHA-256, size budget. Read-only; no network.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        apk: { type: 'string', description: 'Optional APK path relative to the repository root; defaults to the newest build/AnOOPlan-*.apk.' },
      },
    },
    output: OUTPUT,
    async execute(args = {}) {
      const result = apkCheck(cfg, args.apk);
      return { json: JSON.stringify(result, null, 2), markdown: renderApk(result) };
    },
  });

  ctx.tools.register({
    name: 'anooplan_visual_check',
    description: 'Run the Playwright visual-regression suite (npm run test:visual) and return pass/fail with the output tail. update=true regenerates baselines after an intentional UI change. Builds dist, about 40 seconds; baselines are machine-font specific, not for CI.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        update: { type: 'boolean', description: 'Regenerate baselines (npm run test:visual:update) instead of comparing.' },
      },
    },
    output: OUTPUT,
    async execute(args = {}) {
      const result = visualCheck(cfg, { update: args.update === true });
      return { json: JSON.stringify(result, null, 2), markdown: renderVisual(result) };
    },
  });
}
