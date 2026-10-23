// Совместимость со старыми WebView (Chrome 76+, Android 7+).
// Vite собирает бандл под es2019, а здесь лежат фолбэки для API, которых в старых
// WebView ещё нет. Важно: модуль не должен трогать DOM на этапе импорта — его
// используют и юнит-тесты в Node.
type RandomBytes = (bytes: Uint8Array) => Uint8Array;

/** UUID v4 без crypto.randomUUID(): остаётся у WebView до Chrome 92. */
export function uuidFallback(random: RandomBytes = bytes => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** crypto.randomUUID() там, где он есть; иначе — генератор на getRandomValues. */
export function createUuid(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (typeof cryptoApi?.randomUUID === 'function') {
    try { return cryptoApi.randomUUID(); } catch { /* policy/secure context */ }
  }
  return uuidFallback();
}

/** JSON-копия для WebView без structuredClone (Chrome < 98). */
export function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Глубокая копия объектов проекта; structuredClone быстрее, JSON — запасной путь. */
export function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch { /* несериализуемое значение */ }
  }
  return jsonClone(value);
}

/** img.decode() появился в Chrome 64, но в старых WebView его может не быть. */
export function decodeImage(image: HTMLImageElement): Promise<void> {
  if (typeof image.decode === 'function') {
    return image.decode().catch(() => waitForImage(image));
  }
  return waitForImage(image);
}

function waitForImage(image: HTMLImageElement): Promise<void> {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Не удалось загрузить изображение'));
  });
}

export interface DrawableImage {
  width: number;
  height: number;
  draw(context: CanvasRenderingContext2D, width: number, height: number): void;
  close(): void;
}

/**
 * createImageBitmap есть не везде: на старом WebView рисуем через HTMLImageElement.
 * Возвращает одинаковый интерфейс, чтобы сжатие фото не зависело от возможностей WebView.
 */
export async function loadBitmap(blob: Blob): Promise<DrawableImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
        close: () => bitmap.close(),
      };
    } catch { /* формат не поддержан createImageBitmap — пробуем <img> */ }
  }

  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  try {
    await waitForImage(image);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
    close: () => URL.revokeObjectURL(url),
  };
}
