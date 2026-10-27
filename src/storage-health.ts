/** Оценка занятого места в браузере/WebView. Не все среды дают estimate. */
export interface StorageHealth {
  usage: number;
  quota: number;
  ratio: number;
}

export async function storageHealth(): Promise<StorageHealth | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, ratio: quota > 0 ? usage / quota : 0 };
  } catch {
    return null;
  }
}

/** Порог, после которого предупреждаем о риске потери данных. */
export const STORAGE_WARN_RATIO = 0.8;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} ГБ`;
}
