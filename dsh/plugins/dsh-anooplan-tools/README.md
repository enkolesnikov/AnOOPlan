# dsh-anooplan-tools

Проектные проверки AnOOPlan для DSH. Плагин намеренно узкий: работа с устройством/эмулятором живёт
в `dsh-android-tools`, релизы и GitHub — в `dsh-github-tools` (дубли удалены в 0.2.0).

| Инструмент | Что делает |
|---|---|
| `anooplan_apk_check` | Версия/versionCode против `package.json` и манифеста, `INTERNET`, сертификат SHA-256, вес APK. Только чтение, без сети. |
| `anooplan_visual_check` | Запускает `npm run test:visual` (или `test:visual:update`), возвращает успех/провал и хвост вывода. |

## Зависимости

Нет. Только Node builtins (`child_process`, `node:fs`); внешние бинарники — `aapt`/`apksigner`
из `tools/build-tools/35.0.0` и `npm`.

## Установка

```bash
node dsh/install.mjs            # все плагины dsh/plugins/* в профиль web
node dsh/install.mjs --dry-run  # показать действия
```

После установки перезапустите `dsh web`. Проверка без перезапуска:
`node dsh/plugins/dsh-anooplan-tools/selftest.mjs`.

## Настройка

`cordis.patch.yml`: `root`, `buildToolsDir`, `expectedCertSha256`, `maxApkBytes`
(по умолчанию 4 000 000 Б; лимит пересмотрен 2026-10-27, это не ограничение Android).

## Безопасность

- `execFile` с массивом аргументов, без shell; путь к APK ограничен каталогом репозитория.
- Сетевых вызовов нет.
