# Отчёт: находки CodeQL и гигиена репозитория

Дата: 2026-11-19. Ветка: `main`. Версия продукта: **2.9.1** (`androidVersionCode` 46) — не менялась.
Тег и GitHub Release не создавались: правки уходят обычным push в `main`.

Область работ: `server/` (LAN-сервер), `dsh/` (инструменты разработки), `.github/`, тесты и
документация. `src/`, `android/`, `scripts/build-apk.sh` не изменялись.

## Что было до

На `main` было **10 открытых алертов** CodeQL (`security-extended`):

| Severity | Правило | Файл:строка | Суть |
|---|---|---|---|
| high | `js/user-controlled-bypass` | `server/app.ts:158` | манифест вложений проверялся только если прислан |
| high | `js/missing-rate-limiting` | `server/app.ts:145` | `POST /api/restore` без лимита |
| high | `js/missing-rate-limiting` | `server/app.ts:205` | SPA-fallback без лимита |
| high | `js/polynomial-redos` | `dsh/plugins/dsh-github-tools/lib/core.js:16` | `replace(/\/+$/, '')` на длинной строке |
| high | `js/file-system-race` | `dsh/install.mjs:104` | `existsSync` → `writeFileSync` (TOCTOU) |
| high | `js/regex/missing-regexp-anchor` | `tests/release-config.test.ts:75` | регэксп по URL без якоря |
| high | `js/incomplete-sanitization` | `tests/release-policy.test.ts:68` | экранирование только точек в `new RegExp` |
| medium ×3 | `js/file-access-to-http` | `dsh/plugins/dsh-github-tools/lib/core.js:50,112,118` | содержимое файла уходит в HTTP |

Итого: 7 high, 3 medium. `npm audit` (весь дерево): 9 moderate (`minimatch` через `@typescript-eslint`).

## Что сделано

| Алерт | Правило | Что сделано | Коммит | Статус |
|---|---|---|---|---|
| #11 | `js/user-controlled-bypass` | Для `schemaVersion: 2` манифест **обязателен**: без него `422` с текстом про целостность PDF. Legacy `schemaVersion: 1` (и отсутствие версии) разрешены осознанно — старые копии манифеста не содержат; если манифест передан, он проверяется и для v1. Серверный `GET /api/projects/:id/backup` теперь сам отдаёт манифест (`size` + `sha256`), поэтому серверная копия остаётся восстановимой. | `2a4d4b9` | fixed |
| #10 | `js/missing-rate-limiting` | `express-rate-limit`: общий `/api` — 120 запросов/мин с IP, `POST /api/restore` — 10/мин. Лимит стоит **до** авторизации и разбора тела (не тратим память на 80 МБ JSON). Ответ — `429` и JSON `{ "error": "Слишком много запросов" }`. | `2a4d4b9` | fixed |
| #12 | `js/missing-rate-limiting` | SPA-fallback (`dist/index.html`) — 300/мин; `express.static` лимитом не ограничен, чтобы не резать ассеты. | `2a4d4b9` | fixed |
| #6 | `js/polynomial-redos` | Регэксп убран: `normalizeBaseUrl()` режет хвостовые `/` линейным циклом `charCodeAt` + `slice`; вход ограничен 2048 символами (`RangeError`), не-строка — `TypeError`. | `ad519b7` | fixed |
| #5, #7, #8 | `js/file-access-to-http` | Передача содержимого файла в сеть — **осознанная цель** `githubReleaseUpload` (загрузка релизного ассета в GitHub Releases API). Добавлено: путь ограничен workspace (`resolve` + `relative`, отказ на `..`/абсолютный путь до чтения), обоснование в JSDoc, точечные inline-подавления `// codeql[js/file-access-to-http]` на вызовах `fetch`/`body`/`headers`. Правило глобально не отключалось. | `ad519b7` | suppressed (обосновано) |
| #4 | `js/file-system-race` | `dsh/install.mjs`: запись профиля и бэкапа через `openSync(tmp, 'wx')` (O_CREAT\|O_EXCL) → `fsyncSync` → `renameSync` → `chmodSync` (права исходника после `rename`); `existsSync` убран полностью, симлинки создаются сразу с разбором `EEXIST`. Откат — тоже атомарная замена. | `4f3131f` | fixed |
| #9 | `js/regex/missing-regexp-anchor` | `assert.doesNotMatch(ci, /coverage\.codacy\.com/)` → `assert.ok(!ci.includes('coverage.codacy.com'))` — смысл сохранён, регэкспа нет. | `19621b1` | fixed |
| #13 | `js/incomplete-sanitization` | `new RegExp('...' + version.replace(/\./g, '\\.'))` → `manifest.includes('android:versionName="' + version + '"')`; проверка формата версии `^\d+\.\d+\.\d+$` осталась. | `19621b1` | fixed |

### Гигиена репозитория

- `.github/dependabot.yml` — npm (weekly, dev-зависимости одним PR, лимит 5) и github-actions (weekly).
- `SECURITY.md` — приватные GitHub Security Advisories, сроки (72 ч / 7 дней / 30 дней для high),
  поддерживаемые версии (2.9.x), область (APK без `INTERNET`, веб на Pages, LAN-сервер), что приложить.
- `.github/workflows/gitleaks.yml` + `.gitleaks.toml` — gitleaks-action по SHA, `fetch-depth: 0`,
  правила `oc_sk_[A-Za-z0-9_]{16,}`, `github_pat_[A-Za-z0-9_]{40,}`, `gh[pousr]_[A-Za-z0-9]{36,}`,
  PEM-ключи; allowlist — `tests/fixtures`, `docs/`, артефакты сборки. Пользовательских секретов job не
  требует (`GITHUB_TOKEN` выдаётся Actions), падает при находке.
- `.github/codeql/codeql-config.yml` — из анализа исключены `node_modules`, `dist`, `build`, `coverage`,
  `test-results`, `android/assets`, `tools`; правила не отключаются, точечные подавления — рядом с кодом.
- `typescript-eslint` 8.72 → **8.73**, `eslint` 10.13 → **10.15** (подтянул `minimatch` 11.0.9):
  `npm audit` 9 moderate → **0**.

## Метрики

| Метрика | До | После |
|---|---|---|
| Открытые алерты CodeQL | 10 (7 high, 3 medium) | см. раздел «Скан после push» |
| `npm audit` (все зависимости) | 9 moderate | **0** |
| `npm audit --omit=dev` | 0 | **0** |
| Тесты (`npm test`) | 412 pass | **412 pass** |
| Покрытие: строки / ветки / функции | 93/85/92 (порог) | **93.48 / 87.10 / 93.93** |
| Smoke (`npm run smoke`) | 235 проверок | **235, 0 провалов** |
| E2E Playwright | — | **11 passed** |
| Визуальные эталоны | — | **4 passed** |
| Бюджет бандла | JS ≤ 600 КБ, CSS ≤ 60 КБ | **493.2 КБ / 40.9 КБ** |

## Проверки (фактические прогоны)

| Команда | Результат |
|---|---|
| `npm test` | 412 tests, 412 pass, 0 fail |
| `npm run lint` | без ошибок |
| `npx tsc --noEmit` | без ошибок |
| `npm run knip` | без находок |
| `npm run check:secrets` | секретов не найдено (280 файлов) |
| `npm run build && npm run size` | JS 493.2 КБ / 600, CSS 40.9 КБ / 60 — ok |
| `npm run smoke` | 235 проверок, «Итог: УСПЕХ» |
| `npm run coverage` | 93.5 / 87.1 / 93.9 — все пороги пройдены |
| `npx playwright test` | 11 passed |
| `npm run test:visual` | 4 passed |
| `gitleaks dir . --config .gitleaks.toml` (локально, 8.30.1) | 0 находок, 67.2 МБ |
| `gitleaks git .` (167 коммитов) | 0 находок |

`bash tools/test_headless.sh` не запускался: такого файла в репозитории нет.

## Релизный APK не затронут

- В APK попадает только `dist/` (`scripts/build-apk.sh`: `cp -a dist/. android/assets/www/`).
  `server/`, `dsh/`, `.github/`, `tests/`, `docs/` в сборку не входят.
- `android/`, `scripts/build-apk.sh`, `src/` не изменялись; `package.json` — только dev-зависимости
  (`express-rate-limit` нужен LAN-серверу, в бандл не попадает: сервер не импортируется из `src/`).
- Версия 2.9.1 и `androidVersionCode` 46 не менялись; выпущенный 2.9.0 и его тег/Release не трогались.
- Подписанный APK не пересобирался; SHA-256 опубликованного APK остаётся прежним.

## Что осталось и почему

1. **Подтверждение скана CodeQL.** Inline-подавления `// codeql[...]` и закрытие остальных алертов
   проверяются только следующим сканом после push. Если `js/user-controlled-bypass` останется
   (legacy v1 — осознанная ветка формата, а не обход проверки), алерт будет закрыт через API с
   причиной `won't fix` и ссылкой на этот отчёт; если inline-подавление не сработает — подавление
   через API с причиной `used in tests`/`won't fix` и тем же обоснованием.
2. **`js/file-access-to-http`** остаётся особенностью инструмента: плагин по определению читает
   локальный ассет и отправляет его в GitHub Releases. Ограничение workspace и обоснование — в коде.
3. **Peer-предупреждение ESLint.** `eslint-plugin-jsx-a11y@6.10.2` объявляет peer `eslint ^3…^9`,
   а стоит 10.15. `npm ci`, `npm run lint` и CI проходят; обновление плагина — за Dependabot.
4. **gitleaks** установлен только локально в `/tmp` для проверки; бинарь в репозиторий не коммитился.
