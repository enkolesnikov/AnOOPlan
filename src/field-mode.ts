/**
 * Полевой режим (3.0.0): работа на объекте одной рукой.
 *
 * Включается из меню и запоминается в localStorage. В полевом режиме:
 * крупные сенсорные цели, принудительная тёмная «уличная» тема (читается
 * на солнце независимо от системной), нижняя панель из четырёх частых
 * действий, быстрое замечание с камерой и вибро-подтверждение. Ориентация
 * фиксируется в портрете, если WebView/браузер это позволяет: без
 * полноэкранного режима `screen.orientation.lock` вправе отказать — это
 * штатная ситуация, а не ошибка.
 */

export const FIELD_MODE_KEY = 'cableplan:field-mode';

export interface FlagStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): FlagStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readFieldMode(storage: FlagStorage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(FIELD_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeFieldMode(value: boolean, storage: FlagStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(FIELD_MODE_KEY, value ? '1' : '0');
  } catch { /* приватный режим: режим живёт до перезагрузки */ }
}

/** Минимальный контракт Screen Orientation API: в lib.dom текущего TS lock/unlock ещё не описаны. */
interface LockableOrientation {
  lock?(orientation: 'portrait'): Promise<void>;
  unlock?(): void;
}

function orientationApi(): LockableOrientation | undefined {
  return typeof screen === 'undefined' ? undefined : screen.orientation as LockableOrientation | undefined;
}

/** Фиксация портрета; false — платформа отказала или API нет (не ошибка). */
export async function lockPortraitOrientation(): Promise<boolean> {
  try {
    const orientation = orientationApi();
    if (!orientation?.lock) return false;
    await orientation.lock('portrait');
    return true;
  } catch {
    return false;
  }
}

export async function unlockOrientation(): Promise<void> {
  try {
    orientationApi()?.unlock?.();
  } catch { /* API нет — снимать нечего */ }
}
