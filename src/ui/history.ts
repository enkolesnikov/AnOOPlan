/**
 * История изменений: лимит, окно склейки и подписи действий.
 * Склейка нужна, чтобы набор числа или текста отменялся одним шагом,
 * а не по символу.
 */

/** Сколько шагов undo храним (было 60). */
export const HISTORY_LIMIT = 100;

/** Изменения с одинаковой подписью в этом окне считаются одним действием. */
export const GROUP_WINDOW_MS = 600;

/** Добавляет элемент в конец с ограничением длины (старые отбрасываются). */
export function pushLimited<T>(items: T[], item: T, limit = HISTORY_LIMIT): T[] {
  return [...items.slice(-(limit - 1)), item];
}

/** Можно ли не создавать новый шаг undo: та же подпись и прошло меньше окна. */
export function canCoalesce(
  previous: { label: string | undefined; at: number } | null,
  label: string | undefined,
  now: number,
  windowMs = GROUP_WINDOW_MS,
): boolean {
  if (previous === null || label === undefined) return false;
  return previous.label === label && now - previous.at < windowMs;
}
