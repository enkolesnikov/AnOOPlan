# dsh-anooplan-tools

Локальный плагин DSH для проекта AnOOPlan. Даёт агенту четыре инструмента вместо
длинных команд в bash — те проверки, которые реально выполняются при работе над
релизом:

| Инструмент | Что делает |
|---|---|
| `anooplan_apk_check` | Версия/versionCode против `package.json` и манифеста, `INTERNET`, сертификат SHA-256, вес ≤1,6 МБ. Только чтение. |
| `anooplan_android_check` | Ставит свежий APK на подключённый эмулятор/устройство, опционально переключает тёмную тему и `font_scale`, запускает приложение и сохраняет скриншот в `build/`. |
| `anooplan_visual_check` | Запускает `npm run test:visual` (или `test:visual:update`), возвращает успех/провал и хвост вывода. |
| `anooplan_release_status` | Читает GitHub Release по тегу (или latest): активы, размеры, draft/prerelease. Токен — из `GH_TOKEN`/`GITHUB_TOKEN`, иначе анонимно (репозиторий публичный). |

## Зависимости

Нет. Только Node builtins (`child_process`, `node:fs`), поэтому плагин грузится
из `~/.dsh/local-plugins` без установки пакетов. Внешние бинарники, которые
используются: `aapt`, `apksigner` (из `tools/build-tools/35.0.0`), `adb`,
`npm`, при необходимости — GitHub API через `fetch`.

## Установка

Из корня репозитория:

```bash
node dsh/install.mjs            # профиль web по умолчанию
node dsh/install.mjs --dry-run  # показать действия без изменений
```

Скрипт линкует каталог в `~/.dsh/local-plugins`, добавляет пакет в профиль
(`dsh plugin --profile web add link:...`) и включает его в `dsh.profile.bundles`.
После установки **перезапустите `dsh web`** — инструменты появляются в новой
сессии.

## Настройка

Пути и ожидаемый сертификат задаются в `cordis.patch.yml` (поле `config`):
`root`, `adbPath`, `buildToolsDir`, `expectedCertSha256`, `maxApkBytes`,
`repoSlug`. Если репозиторий лежит не в `/root/Anooplan`, поправьте `root`.

## Проверка без перезапуска

```bash
node dsh/plugins/dsh-anooplan-tools/selftest.mjs
```

Self-test регистрирует инструменты в фейковом `ctx` и проверяет APK из `build/`.

## Безопасность

- Команды запускаются через `execFile`/`spawnSync` с массивом аргументов, без
  shell-подстановок; пользовательский ввод не попадает в строку команды.
- Пути к APK и скриншотам ограничены каталогом репозитория.
- `anooplan_android_check` меняет системные настройки эмулятора только если явно
  переданы `dark` или `fontScale`.
- Плагин не делает сетевых вызовов, кроме `anooplan_release_status` (GitHub API).
