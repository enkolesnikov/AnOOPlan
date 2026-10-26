# DSH: плагины для работы над AnOOPlan

Каталог описывает плагинную обвязку агента, которая используется в этом
репозитории: что нужно установить в профиль DSH и что написано нами.

## Что внутри

```
dsh/
├── install.mjs                     # установка всех локальных плагинов в профиль
├── plugins.required.json           # внешние плагины, которые используются
├── README.md                       # этот файл
└── plugins/
    ├── dsh-anooplan-tools/         # проектные проверки AnOOPlan
    ├── dsh-android-tools/          # обёртка adb/эмулятора
    └── dsh-github-tools/           # GitHub: релизы, workflow, issues
```

## Внешние плагины (устанавливаются в профиль)

Версии — из профиля `web` на момент 2.5.0; при обновлении могут отличаться.

| Плагин | Зачем | Установка |
|---|---|---|
| `dshmarket` | витрина плагинов в интерфейсе | `dsh plugin --profile web add dshmarket` |
| `@feng0531/dsh-code-review` | независимый code review (Git/SVN) | `dsh plugin --profile web add @feng0531/dsh-code-review` |
| `@lemoncat7/dsh-ssh` | SSH-доступ к VPS | `dsh plugin --profile web add @lemoncat7/dsh-ssh` |
| `@michengai/dsh-automation` | отложенные задачи/напоминания | `dsh plugin --profile web add @michengai/dsh-automation` |
| `@goodandready/dsh-messenger-gateway` | уведомления в Telegram | `dsh plugin --profile web add @goodandready/dsh-messenger-gateway` |
| `@goodandready/dsh-russian-lang` | русская локализация интерфейса | `dsh plugin --profile web add @goodandready/dsh-russian-lang` |
| `dsh-session-report` | отчёт о сессии в Telegram (локальный) | `dsh plugin --profile web add link:/root/.dsh/local-plugins/dsh-session-report` |

Точный список и версии — в `plugins.required.json`. Эти плагины не входят в
рантайм приложения и не влияют на APK/офлайн-контракт.

## Самописные плагины

### `dsh-anooplan-tools` — проектные проверки

- `anooplan_apk_check` — версия/versionCode против `package.json` и манифеста,
  `INTERNET`, сертификат SHA-256, вес;
- `anooplan_android_check` — установка APK на эмулятор, тёмная тема/`font_scale`,
  запуск, ожидание готовности WebView и скриншот в `build/` (переживает
  системный ANR-диалог эмулятора);
- `anooplan_visual_check` — прогон визуальных эталонов `npm run test:visual`;
- `anooplan_release_status` — активы GitHub Release по тегу.

### `dsh-android-tools` — обёртка adb/эмулятора

| Инструмент | Что делает |
|---|---|
| `android_devices` | Список устройств (`adb devices -l`). |
| `android_boot` | Запуск headless-эмулятора из AVD и ожидание загрузки. |
| `android_install` | `adb install -r`, опционально запуск activity. |
| `android_screenshot` | Скриншот в `build/screenshot-<ts>.png`. |
| `android_set` | Тёмная тема и `font_scale` 0.85–1.6. |
| `android_logcat` | Последние строки `logcat -d` с фильтром. |

### `dsh-github-tools` — GitHub

| Инструмент | Что делает |
|---|---|
| `github_release` | Релиз по тегу/latest: активы, размеры, draft/prerelease. |
| `github_release_upload` | Загрузка файла в релиз (нужен токен). |
| `github_workflow_runs` | Actions-запуски с выводом и длительностью. |
| `github_issues` | Issues (PR исключаются). |

## Установка

```bash
node dsh/install.mjs --dry-run   # показать действия
node dsh/install.mjs             # все плагины dsh/plugins/* в профиль web
```

Скрипт линкует каждый каталог в `~/.dsh/local-plugins`, добавляет link-зависимости,
включает плагины в `dsh.profile.bundles` (с резервной копией `package.json`) и
проверяет `dsh --profile web --dump-config`. Если проверка не прошла — bundle
откатываются.

После установки **перезапустите `dsh web`**: инструменты появляются в новой
сессии. Проверка без перезапуска:

```bash
node dsh/plugins/dsh-anooplan-tools/selftest.mjs
node dsh/plugins/dsh-android-tools/selftest.mjs
node dsh/plugins/dsh-github-tools/selftest.mjs
```

## Настройка

Конфиг каждого плагина — в его `cordis.patch.yml`:

- `dsh-anooplan-tools`: `root`, `adbPath`, `buildToolsDir`, `expectedCertSha256`,
  `maxApkBytes`, `repoSlug`;
- `dsh-android-tools`: `adbPath`, `emulatorPath`, `avdHome`, `emulatorHome`,
  `defaultAvd`, `screenshotDir`;
- `dsh-github-tools`: `repoSlug`, `apiBase`, `root`.

`GH_TOKEN`/`GITHUB_TOKEN` читается только из окружения; в файлы не пишется.

## Безопасность

- Инструменты запускают только локальные бинарники с фиксированными аргументами
  (без shell), пути к APK/скриншотам ограничены репозиторием.
- Сеть есть только у GitHub-инструментов.
- Установщик меняет только `~/.dsh/local-plugins` и `package.json` профиля;
  перед изменением bundles делается резервная копия, при ошибке — откат.
