# dsh-android-tools

Обёртка над `adb`/эмулятором для DSH. Без внешних зависимостей и shell.

| Инструмент | Что делает |
|---|---|
| `android_devices` | Список устройств (`adb devices -l`). |
| `android_boot` | Запуск headless-эмулятора из настроенного AVD и ожидание `sys.boot_completed=1`. |
| `android_install` | `adb install -r`, опционально запуск activity и версия пакета. |
| `android_screenshot` | Скриншот в `build/screenshot-<ts>.png`. |
| `android_set` | Тёмная тема (`uimode night`) и `font_scale` 0.85–1.6. |
| `android_logcat` | Последние строки `logcat -d` с фильтром. |

Установка — `node dsh/install.mjs` (все плагины `dsh/plugins/*`). Настройки — в
`cordis.patch.yml`: путь к `adb`, эмулятору, AVD-home, имя AVD, каталог
скриншотов. Проверка без перезапуска: `node dsh/plugins/dsh-android-tools/selftest.mjs`.
