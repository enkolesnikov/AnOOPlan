/**
 * dsh-android-tools — дополнение к @zseven-w/dsh-android.
 *
 * Устройства, запуск эмулятора, скриншоты и логи даёт маркет-плагин; здесь только
 *   android_install — установка произвольного APK (не только Gradle-сборки);
 *   android_set     — системная тема и font_scale для проверки доступности.
 *
 * @module dsh-android-tools
 */
import { androidInstall, androidSet } from './core.js';

export const name = 'dsh-android-tools';
export const inject = ['tools'];

const DEFAULTS = {
  adbPath: '/root/android-sdk/platform-tools/adb',
  root: '/root/Anooplan',
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

function renderInstall(result) {
  if (!result.ok) return ['Установка APK: ошибка', ...result.problems.map(p => `- ${p}`)].join('\n');
  return [
    `Устройство: ${result.serial}`,
    `APK: ${result.apk}`,
    `Версия: ${result.versionName ?? '—'} (${result.versionCode ?? '—'})`,
    result.launched ? 'Приложение запущено.' : 'Приложение не запускалось.',
  ].join('\n');
}

function renderSet(result) {
  if (!result.ok) return ['Настройки Android: ошибка', ...result.problems.map(p => `- ${p}`)].join('\n');
  return `Применено на ${result.serial}: ${result.applied.join(', ')}`;
}

/** Регистрирует дополнения к Android-плагину. */
export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config };

  ctx.tools.register({
    name: 'android_install',
    description: 'Install an arbitrary APK on the connected device (adb install -r), optionally launch an activity and report versionName/versionCode. Complements @zseven-w/dsh-android, which only installs Gradle build outputs.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        apk: { type: 'string', description: 'APK path (absolute or relative to config.root); required.' },
        serial: { type: 'string', description: 'Optional adb serial; defaults to the first connected device.' },
        launch: { type: 'string', description: 'Optional component to launch, e.g. com.anooplan.app/.MainActivity.' },
      },
      required: ['apk'],
    },
    output: OUTPUT,
    async execute(args = {}) {
      const result = androidInstall(cfg, args);
      return { json: JSON.stringify(result, null, 2), markdown: renderInstall(result) };
    },
  });

  ctx.tools.register({
    name: 'android_set',
    description: 'Switch system night mode (dark/light) and/or set system font_scale 0.85–1.6 — for accessibility checks of the installed APK.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        serial: { type: 'string', description: 'Optional adb serial.' },
        dark: { type: 'boolean', description: 'true = night mode, false = light mode; omit to leave unchanged.' },
        fontScale: { type: 'number', description: 'font_scale 0.85–1.6; omit to leave unchanged.' },
      },
    },
    output: OUTPUT,
    async execute(args = {}) {
      const result = androidSet(cfg, args);
      return { json: JSON.stringify(result, null, 2), markdown: renderSet(result) };
    },
  });
}
