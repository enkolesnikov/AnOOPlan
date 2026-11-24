package com.anooplan.app;

/**
 * Системный масштаб шрифта (fontScale, 1.0 = 100 %) → процент textZoom WebView.
 * Зеркало {@code resolveTextZoom} из src/a11y.ts (Java не импортирует TypeScript);
 * константы сверяются с src/a11y.ts тестом android-config.test.ts.
 */
final class TextZoom {

    /** Границы textZoom, %: совпадают с TEXT_ZOOM_MIN/MAX в src/a11y.ts. */
    static final int TEXT_ZOOM_MIN = 85;
    static final int TEXT_ZOOM_MAX = 160;
    /** textZoom по умолчанию, %: для некорректного системного fontScale. */
    static final int TEXT_ZOOM_DEFAULT = 100;

    private TextZoom() { }

    /** Округляет fontScale до процента и зажимает в 85–160 %; некорректное даёт 100 %. */
    static int textZoomPercent(float fontScale) {
        if (Float.isNaN(fontScale) || Float.isInfinite(fontScale) || fontScale <= 0f) {
            return TEXT_ZOOM_DEFAULT;
        }
        int percent = Math.round(fontScale * 100f);
        return Math.min(TEXT_ZOOM_MAX, Math.max(TEXT_ZOOM_MIN, percent));
    }
}
