# dsh-android-tools

Дополнение к маркет-плагину `@zseven-w/dsh-android`. Устройства, запуск эмулятора,
скриншоты, UI-дерево и логи даёт маркет-плагин; здесь только два инструмента,
которых в нём нет:

| Инструмент | Что делает |
|---|---|
| `android_install` | Ставит **произвольный** APK (`adb install -r`), опционально запускает activity и возвращает versionName/versionCode. Маркет-плагин умеет только `build`+`install` из Gradle. |
| `android_set` | Системная тёмная тема (`uimode night`) и `font_scale` 0.85–1.6 — проверка доступности APK. |

## Зависимости

Нет. Только Node builtins и `adb` из Android SDK.

## Установка

```bash
node dsh/install.mjs
```

Конфиг — `cordis.patch.yml`: `adbPath`, `root`. Проверка без перезапуска:
`node dsh/plugins/dsh-android-tools/selftest.mjs`.

## Безопасность

`execFile` с массивом аргументов, без shell; путь к APK ограничен каталогом репозитория.
