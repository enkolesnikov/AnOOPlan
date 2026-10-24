/** Blob → base64 без префикса data:. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
}

// Нативная оболочка Android (AnOOPlan) подключает мост AnOOPlanNative:
// через него экспортированные файлы попадают в «Загрузки/AnOOPlan».
export type NativeBridgeApi = {
  platform?: () => string;
  saveFile?: (name: string, base64: string, mime: string) => string;
  /** «Поделиться» файлом через системный диалог Android. */
  shareFile?: (name: string, base64: string, mime: string) => string;
  /** JSON .anooplan, открытого из системы; пустая строка, если файла нет. */
  takePendingFile?: () => string;
  setDirty?: (dirty: boolean) => void;
  exitNow?: () => void;
  vibrate?: (milliseconds: number) => void;
  printPdf?: (name: string, base64: string) => void;
};
export const nativeBridge = (): NativeBridgeApi | null => (window as unknown as { AnOOPlanNative?: NativeBridgeApi }).AnOOPlanNative ?? null;
export const isNativeApp = (): boolean => typeof nativeBridge()?.saveFile === 'function';
/** Uint8Array → base64 чанками, чтобы не переполнить стек на больших PDF. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x4000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
/** Сохранить файл через нативный мост; null — моста нет, вызывающий качает файл браузером. */
export async function saveBlobOnDevice(name: string, blob: Blob): Promise<string | null> {
  const bridge = nativeBridge();
  if (typeof bridge?.saveFile !== 'function') return null;
  const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  const result = bridge.saveFile(name, base64, blob.type || 'application/octet-stream');
  if (result.startsWith('ok:')) return result.slice(3);
  throw new Error(result.replace(/^err:\s*/, '') || 'Не удалось сохранить файл на устройстве');
}

/** Тактильный отклик на нативных устройствах; в браузере молча игнорируется. */
export const vibrate = (milliseconds = 12): void => { nativeBridge()?.vibrate?.(milliseconds); };
