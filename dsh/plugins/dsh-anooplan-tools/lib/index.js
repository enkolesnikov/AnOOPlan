/**
 * dsh-anooplan-tools — локальный плагин DSH для проекта AnOOPlan.
 *
 * Регистрирует четыре модельных инструмента без внешних зависимостей:
 *   anooplan_apk_check       — статическая проверка подписанного APK;
 *   anooplan_android_check   — установка на эмулятор, тема/шрифт, скриншот;
 *   anooplan_visual_check    — визуальные эталоны (npm run test:visual);
 *   anooplan_release_status  — активы GitHub Release по тегу.
 *
 * Плагин рассчитан на локальную машину владельца: команды выполняются от его
 * имени, без сети (кроме release_status) и без shell-подстановок.
 *
 * @module dsh-anooplan-tools
 */
import { apkCheck, androidCheck, releaseStatus, visualCheck } from './core.js';

export const name = 'dsh-anooplan-tools';
export const inject = ['tools'];

const DEFAULTS = {
  root: '/root/Anooplan',
  adbPath: '/root/android-sdk/platform-tools/adb',
  buildToolsDir: 'tools/build-tools/35.0.0',
  expectedCertSha256: '6431374cf6a7d385c4c47f0f2bf54fcb5ee5b2c7120f057b18c4062af92fe097',
  maxApkBytes: 1_600_000,
  repoSlug: 'enkolesnikov/AnOOPlan',
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

function lines(title, items) {
  return [title, ...items.map(item => `- ${item}`)].join('\n');
}

function renderApk(result) {
  if (!result.apk) return lines('APK: проверка не выполнена', result.problems);
  const checks = Object.entries(result.checks ?? {})
    .map(([key, ok]) => `${ok ? '✅' : '❌'} ${key}`);
  const body = [
    `APK: \`${result.apk}\``,
    `Версия: ${result.versionName} (versionCode ${result.versionCode})`,
    `Вес: ${result.sizeMB} МБ (${result.sizeBytes} Б)`,
    `Сертификат: ${result.certificateSha256 ?? '—'}`,
    `Разрешения: ${result.permissions.join(', ') || 'нет'}`,
    '',
    lines('Проверки:', checks),
  ];
  if (result.problems.length > 0) body.push('', lines('Проблемы:', result.problems));
  return body.join('\n');
}

function renderDevice(result) {
  if (!result.serial) return lines('Устройство: проверка не выполнена', result.problems);
  const body = [
    `Устройство: ${result.serial}`,
    `APK: \`${result.apk}\`${result.installed ? ' (установлен)' : ''}`,
    `Версия на устройстве: ${result.versionName ?? '—'} (${result.versionCode ?? '—'})`,
  ];
  if (result.theme) body.push(`Тема: ${result.theme}`);
  if (result.fontScale !== null && result.fontScale !== undefined) body.push(`fontScale: ${result.fontScale}`);
  if (result.screenshot) body.push(`Скриншот: \`${result.screenshot}\``);
  if (result.problems.length > 0) body.push('', lines('Проблемы:', result.problems));
  return body.join('\n');
}

function renderVisual(result) {
  const head = `Визуальные эталоны: ${result.ok ? 'успех' : 'провал'} · ${result.script} · ${result.durationSeconds} с`;
  return [head, ...(result.problems.length ? ['', lines('Проблемы:', result.problems)] : []), '', '```', result.tail, '```'].join('\n');
}

function renderRelease(result) {
  if (!result.tag) return lines('GitHub Release: проверка не выполнена', result.problems);
  const body = [
    `Релиз: ${result.tag}${result.name ? ` — ${result.name}` : ''}`,
    `Черновик: ${result.draft ? 'да' : 'нет'} · пререлиз: ${result.prerelease ? 'да' : 'нет'}`,
    `Опубликован: ${result.publishedAt ?? '—'}`,
    `Ссылка: ${result.url ?? '—'}`,
    `Описание: ${result.bodyLines} строк`,
    '',
    lines('Активы:', (result.assets ?? []).map(asset => `${asset.name} — ${asset.size} Б`)),
  ];
  if (result.problems.length > 0) body.push('', lines('Проблемы:', result.problems));
  return body.join('\n');
}

/**
 * Регистрирует инструменты AnOOPlan в текущем DSH-профиле.
 * @param ctx — сервисы агента (нужен только tools).
 * @param config — настройки путей из cordis.patch.yml.
 */
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
    name: 'anooplan_android_check',
    description: 'Install the latest APK on the connected emulator/device, optionally switch system dark theme or font scale, launch, and save a screenshot into build/. Requires adb and a booted device. Changes emulator settings only when dark/fontScale are passed.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        apk: { type: 'string', description: 'Optional APK path relative to the repository root.' },
        serial: { type: 'string', description: 'Optional adb serial; defaults to the first connected device.' },
        install: { type: 'boolean', description: 'Install the APK before launch (default true).' },
        screenshot: { type: 'boolean', description: 'Save a screenshot into build/ (default true).' },
        dark: { type: 'boolean', description: 'Switch system night mode: true = dark, false = light; omit to leave unchanged.' },
        fontScale: { type: 'number', description: 'System font_scale 0.85–1.6 to check textZoom; omit to leave unchanged.' },
      },
    },
    output: OUTPUT,
    async execute(args = {}) {
      const result = await androidCheck(cfg, args);
      return { json: JSON.stringify(result, null, 2), markdown: renderDevice(result) };
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

  ctx.tools.register({
    name: 'anooplan_release_status',
    description: 'Read GitHub release info for a tag (or the latest release): name, draft/prerelease, assets with sizes. Uses GH_TOKEN/GITHUB_TOKEN from the environment when present; the repository is public, so an unauthenticated read also works.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tag: { type: 'string', description: 'Release tag (e.g. v2.5.0); omit for the latest release.' },
      },
    },
    output: OUTPUT,
    async execute(args = {}) {
      const result = await releaseStatus(cfg, { tag: args.tag });
      return { json: JSON.stringify(result, null, 2), markdown: renderRelease(result) };
    },
  });
}
