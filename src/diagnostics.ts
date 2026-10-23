// Локальный журнал ошибок: до 50 записей в localStorage. Нужен для полевой
// диагностики, когда приложение не отрисовало PDF или упало без видимой ошибки.

export type DiagnosticKind = 'error' | 'rejection' | 'message';

export interface DiagnosticEntry {
  at: string;
  kind: DiagnosticKind;
  context?: string;
  message: string;
  stack?: string;
}

export interface DiagnosticStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = 'cableplan:diagnostics';
const LIMIT = 50;
const MAX_TEXT = 4000;
let installed = false;

function defaultStorage(): DiagnosticStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function asMessage(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === 'string') return value;
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

function asStack(value: unknown): string | undefined {
  return value instanceof Error && value.stack ? value.stack.slice(0, MAX_TEXT) : undefined;
}

export function readDiagnostics(storage: DiagnosticStorage | null = defaultStorage()): DiagnosticEntry[] {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is DiagnosticEntry =>
      Boolean(item) && typeof item === 'object' &&
      typeof (item as DiagnosticEntry).at === 'string' &&
      typeof (item as DiagnosticEntry).message === 'string' &&
      typeof (item as DiagnosticEntry).kind === 'string',
    ).slice(-LIMIT);
  } catch {
    return [];
  }
}

export function logDiagnostic(
  kind: DiagnosticKind,
  error: unknown,
  context?: string,
  storage: DiagnosticStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    const entry: DiagnosticEntry = { at: new Date().toISOString(), kind, message: asMessage(error).slice(0, MAX_TEXT), context };
    const stack = asStack(error);
    if (stack) entry.stack = stack;
    const list = [...readDiagnostics(storage), entry].slice(-LIMIT);
    storage.setItem(KEY, JSON.stringify(list));
  } catch {
    // переполнение или закрытое хранилище: журнал не должен ломать приложение
  }
}

export function clearDiagnostics(storage: DiagnosticStorage | null = defaultStorage()): void {
  try { storage?.removeItem(KEY); } catch { /* хранилище недоступно */ }
}

export function diagnosticsText(version: string, storage: DiagnosticStorage | null = defaultStorage()): string {
  const entries = readDiagnostics(storage);
  const userAgent = typeof navigator === 'undefined' ? '—' : navigator.userAgent;
  const lines = [
    'AnOOPlan — диагностика',
    `Версия приложения: ${version}`,
    `Сформировано: ${new Date().toISOString()}`,
    `WebView / браузер: ${userAgent}`,
    `Записей: ${entries.length}`,
    '---',
  ];
  for (const entry of entries) {
    lines.push(`${entry.at} [${entry.kind}]${entry.context ? ` (${entry.context})` : ''}`);
    lines.push(entry.message);
    if (entry.stack) lines.push(entry.stack);
    lines.push('');
  }
  return lines.join('\n');
}

/** Подключает перехват необработанных ошибок и отклонённых промисов. */
export function installDiagnostics(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', event => {
    const where = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : 'window.error';
    logDiagnostic('error', event.error ?? event.message, where);
  });
  window.addEventListener('unhandledrejection', event => {
    logDiagnostic('rejection', event.reason, 'unhandledrejection');
  });
}
