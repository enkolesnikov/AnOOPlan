/**
 * Доступность: системный размер шрифта Android и цвет системной темы.
 *
 * Android WebView сам по себе не масштабирует текст по настройке «Размер шрифта»:
 * оболочка (android/java/com/anooplan/app/MainActivity.java) читает
 * `Configuration.fontScale` и передаёт процент в `WebSettings.setTextZoom`.
 * Java-код не может импортировать TypeScript, поэтому правила приведения
 * продублированы здесь как эталонная реализация с юнит-тестами
 * (tests/a11y.test.ts). Меняя границы или округление, синхронно правьте
 * `MainActivity.textZoomPercent` — тест tests/android-config.test.ts сверяет файлы.
 */

/** Нижняя граница textZoom, %: мельче системный шрифт не делаем. */
export const TEXT_ZOOM_MIN = 85;
/** Верхняя граница textZoom, %: дальше раскладка на телефоне разваливается. */
export const TEXT_ZOOM_MAX = 160;
/** Безопасное значение, %: некорректный fontScale не должен ломать интерфейс. */
export const TEXT_ZOOM_DEFAULT = 100;

/** Допустимый диапазон системного fontScale (1.0 = 100 %). */
export const FONT_SCALE_MIN = TEXT_ZOOM_MIN / 100;
/** Верхняя граница системного fontScale, соответствующая textZoom 160 %. */
export const FONT_SCALE_MAX = TEXT_ZOOM_MAX / 100;

/** Цвет строки состояния для светлой темы (совпадает с --bg в styles.css). */
export const THEME_COLOR_LIGHT = '#122936';
/** Цвет строки состояния для тёмной темы (совпадает с --bg тёмной темы). */
export const THEME_COLOR_DARK = '#0b1a22';

/**
 * Приводит системный `fontScale` Android (1.0 = 100 %) к целому проценту textZoom.
 *
 * - значение умножается на 100 и округляется до целого;
 * - результат зажимается в диапазон {@link TEXT_ZOOM_MIN}…{@link TEXT_ZOOM_MAX};
 * - всё некорректное (NaN, ±Infinity, ноль, отрицательные значения, строки,
 *   null/undefined, объекты) даёт {@link TEXT_ZOOM_DEFAULT} (100 %).
 *
 * @param fontScale `Configuration.fontScale` из ресурсов Android.
 */
export function resolveTextZoom(fontScale: unknown): number {
  if (typeof fontScale !== 'number' || !Number.isFinite(fontScale) || fontScale <= 0) {
    return TEXT_ZOOM_DEFAULT;
  }
  const percent = Math.round(fontScale * 100);
  return Math.min(TEXT_ZOOM_MAX, Math.max(TEXT_ZOOM_MIN, percent));
}

/** Цвет theme-color для текущей системной темы: тёмная — #0b1a22, светлая — #122936. */
export function resolveThemeColor(dark: boolean): string {
  return dark ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
}
