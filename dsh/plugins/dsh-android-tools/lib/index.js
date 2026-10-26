/**
 * dsh-android-tools — обёртка над adb/эмулятором для DSH.
 * Инструменты: устройства, запуск эмулятора, установка APK, скриншот,
 * тёмная тема/размер шрифта, logcat.
 *
 * @module dsh-android-tools
 */
import { androidBoot, androidDevices, androidInstall, androidLogcat, androidScreenshot, androidSet } from './core.js';

export const name = 'dsh-android-tools';
export const inject = ['tools'];

const DEFAULTS = {
  adbPath: '/root/android-sdk/platform-tools/adb',
  emulatorPath: '/root/android-sdk/emulator/emulator',
  avdHome: '/root/Anooplan/build/avd-home',
  emulatorHome: '/root/Anooplan/build/android-home',
  defaultAvd: 'AnOOPlan25',
  screenshotDir: '/root/Anooplan/build',
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

const list = (title, items) => [title, ...items.map(item => `- ${item}`)].join('\n');

function renderDevices(result) {
  if (!result.ok) return list('Устройства: ошибка', result.problems);
  return list('Подключённые устройства:', result.devices.map(device => `${device.serial} — ${device.state} ${device.details}`));
}

function renderBoot(result) {
  if (!result.ok) return list('Эмулятор: ошибка', result.problems);
  return `Эмулятор готов: ${result.serial}${result.alreadyRunning ? ' (уже был запущен)' : ` (запущен ${result.avd})`}`;
}

function renderInstall(result) {
  if (!result.ok) return list('Установка: ошибка', result.problems);
  return [
    `Устройство: ${result.serial}`,
    `APK: ${result.apk}`,
    `Версия: ${result.versionName ?? '—'} (${result.versionCode ?? '—'})`,
    result.launched ? 'Приложение запущено.' : 'Приложение не запускалось.',
  ].join('\n');
}

function renderScreenshot(result) {
  if (!result.ok) return list('Скриншот: ошибка', result.problems);
  return `Скриншот: \`${result.path}\` (${result.sizeBytes} Б, ${result.serial})`;
}

function renderSet(result) {
  if (!result.ok) return list('Настройки: ошибка', result.problems);
  return `Применено на ${result.serial}: ${result.applied.join(', ')}`;
}

function renderLogcat(result) {
  if (!result.ok) return list('logcat: ошибка', result.problems);
  return [`logcat (${result.lines} строк, ${result.serial}):`, '```', result.text || '—', '```'].join('\n');
}

/** Регистрирует Android-инструменты. */
export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config };

  ctx.tools.register({
    name: 'android_devices',
    description: 'List connected Android devices/emulators via adb devices -l (serial, state, model). Read-only.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: OUTPUT,
    async execute() {
      const result = androidDevices(cfg);
      return { json: JSON.stringify(result, null, 2), markdown: renderDevices(result) };
    },
  });

  ctx.tools.register({
    name: 'android_boot',
    description: 'Boot a headless Android emulator via the configured AVD if no device is connected, then wait until sys.boot_completed=1. Returns the adb serial.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        avd: { type: 'string', description: 'Optional AVD name; defaults to config.defaultAvd.' },
        timeoutMs: { type: 'number', description: 'Boot timeout in milliseconds (default 180000).' },
      },
    },
    output: OUTPUT,
    async execute(args = {}) {
      const result = await androidBoot(cfg, args);
      return { json: JSON.stringify(result, null, 2), markdown: renderBoot(result) };
    },
  });

  ctx.tools.register({
    name: 'android_install',
    description: 'Install an APK on the connected device (adb install -r), optionally launch an activity and report versionName/versionCode.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        apk: { type: 'string', description: 'APK path (absolute or relative to config.root); required.' },
        serial: { type: 'string', description: 'Optional adb serial.' },
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
    name: 'android_screenshot',
    description: 'Capture the current device screen into a PNG file (default: build/screenshot-<timestamp>.png).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        serial: { type: 'string', description: 'Optional adb serial.' },
        path: { type: 'string', description: 'Optional output path relative to config.root.' },
      },
    },
    output: OUTPUT,
    async execute(args = {}) {
      const result = androidScreenshot(cfg, args);
      return { json: JSON.stringify(result, null, 2), markdown: renderScreenshot(result) };
    },
  });

  ctx.tools.register({
    name: 'android_set',
    description: 'Switch system night mode (dark/light) and/or set system font_scale 0.85–1.6 on the connected device.',
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

  ctx.tools.register({
    name: 'android_logcat',
    description: 'Read the last logcat lines from the device (adb logcat -d), optionally filtered by a substring.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        serial: { type: 'string', description: 'Optional adb serial.' },
        lines: { type: 'number', description: 'Number of lines, 1–2000 (default 200).' },
        filter: { type: 'string', description: 'Optional substring filter (case-sensitive).' },
      },
    },
    output: OUTPUT,
    async execute(args = {}) {
      const result = androidLogcat(cfg, args);
      return { json: JSON.stringify(result, null, 2), markdown: renderLogcat(result) };
    },
  });
}
