# Контекст-хендофф: AnOOPlan

Документ для продолжения работы в новой сессии. Прочитайте его целиком перед первым действием.
Секретов здесь нет: токены и пароли передаются отдельно и в репозиторий не попадают.

## Что это за проект

**AnOOPlan** — приложение для раскладки кабельных трасс по PDF-планам здания и расчёта кабельного
журнала. Основной продукт — **офлайн-APK для Android**; та же кодовая база собирается как веб-версия
на GitHub Pages. Выросло из веб-приложения [ooplan](https://github.com/enkolesnikov/ooplan) (CablePlan).

- Репозиторий: <https://github.com/enkolesnikov/AnOOPlan>
- Релизы с APK: <https://github.com/enkolesnikov/AnOOPlan/releases>
- Веб-версия: <https://enkolesnikov.github.io/AnOOPlan/>
- Текущая версия: **1.13.0**, versionCode 21, `com.anooplan.app`, minSdk 24, targetSdk 35.
  APK ~1,8 МБ, WebView 98+, 94 юнит-теста + E2E.
- Подпись: SHA-256 сертификата `6431374cf6a7d385c4c47f0f2bf54fcb5ee5b2c7120f057b18c4062af92fe097`.

## Режимы работы

| Режим | Где используется | Хранение |
|---|---|---|
| **Браузер / APK** (основной) | APK и GitHub Pages | Проекты — `localStorage`, PDF/фото/снимки — IndexedDB |
| **Сервер** (вспомогательный) | `npm start`, локальная веб-версия | SQLite (`node:sqlite`) + PDF в `data/` |

APK всегда работает в режиме «Браузер»: запрос `/api/health` получает 404, приложение включает
`staticMode`. Серверная часть остаётся для локального веба и не входит в APK.

## Стек и устройство

Формулы расчёта, API и детали модели — в [ARCHITECTURE.md](../ARCHITECTURE.md); история версий — в README и git.

| Слой | Где | Что внутри |
|---|---|---|
| Движок расчёта | `src/engine.ts` | длины, запасы, Дейкстра, спецификации, проверки |
| Модель данных | `src/model.ts` | `Project` → этажи, оборудование, трассы, кабели, документ |
| Интерфейс | `src/App.tsx` | один компонент: план canvas+SVG, свойства, журнал, ведомости |
| Выгрузка | `src/sheets.ts`, `src/export-xlsx.ts`, `src/export-pdf.ts` | листы, XLSX (SheetJS), PDF (pdf-lib + PT Sans) |
| План в PDF | `src/plan-svg.ts` + `capturePlan()` | прозрачный SVG-оверлей поверх растра PDF |
| Большие листы | `src/render-plan.ts` | бюджет 12 Мпикс, рендер видимой области для A1/A0 |
| Хранилище | `src/idb.ts`, `src/local-projects.ts`, `src/storage-gc.ts`, `src/garbage-collector.ts` | IndexedDB, список проектов, фоновый GC сирот |
| Хуки | `src/use-*.ts` | история, PDF-подложка, снимки, фото |
| Диагностика | `src/diagnostics.ts` | локальный журнал ошибок (50 записей), экспорт |
| Схема проекта | `src/migrations.ts` | миграции/нормализация, `CURRENT_SCHEMA_VERSION`, отказ от будущих версий |
| Совместимость | `src/compat.ts`, `src/polyfills.ts`, `src/pdf-worker.ts` | фолбэки WebView, полифилл `Promise.withResolvers` |
| Оболочка Android | `android/java/com/anooplan/app/` | `MainActivity`, `AssetServer`, `NativeBridge`, `PdfPrinter` |
| Сборка APK | `scripts/build-apk.sh`, `scripts/fetch-tools.sh` | aapt + javac + d8 + zipalign + apksigner, **без Gradle** |
| Тесты | `tests/*.test.ts`, `tests/e2e/`, `scripts/smoke-dom.mjs` | 89 юнит-тестов, смоук happy-dom и Playwright E2E с реальным PDF |

### Ключевые решения (не пересматривать без причины)

1. **WebView вместо Kotlin-переписывания.** Одна кодовая база для сайта и APK, 94 теста, быстрые
   итерации. Kotlin оправдан только при ежедневной работе пером и листах A1+ — тогда начинать
   с порта `engine.ts` в KMP, а не с UI.
2. **Статика отдаётся по origin `https://appassets.local/`** через `AssetServer.shouldInterceptRequest`.
   На `file://` не работают IndexedDB и `crypto.randomUUID()`. Запросы `/api/*` получают 404 →
   включается `staticMode`.
3. **Всё офлайн.** Разрешение `INTERNET` не запрашивается. Никаких сетевых вызовов в APK нет.
4. **Экспорт на клиенте.** XLSX и PDF собираются на телефоне; печать — `PrintManager` с готовым PDF
   в спулер без растеризации. Файлы сохраняются через MediaStore, без опасных разрешений.
5. **Подпись.** `keystore/anooplan.jks` (в `.gitignore`), пароль в `keystore/pass.txt` (0600, вне git).
   Пароль не хранится в скриптах; `scripts/build-apk.sh` читает `keystore/pass.txt` или `KS_PASS`.
   GitHub Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KS_PASS`, `ANDROID_KS_ALIAS`,
   `ANDROID_CERT_SHA256`.
   **Важно:** в сессии 2026-10 на VPS сгенерирован новый ключ (оригинальный в репозиторий не входит).
   APK с 1.6.1 подписаны им; обновление поверх 1.6.0 требует переустановки (сначала сохранить проект
   в JSON). Если появится оригинальный keystore — положить его в `keystore/anooplan.jks`, заменить
   пароль и пересобрать релиз.
6. **Автобэкап выключен** (`allowBackup="false"`): проекты могут содержать планы заказчика.
   Перед переустановкой/удалением приложения пользователь должен сохранить JSON-копию.
7. **История и GC.** Снимки проектов (до 20 на проект) лежат в IndexedDB. Фоновый GC удаляет
   PDF/фото, на которые больше не ссылаются текущий проект, undo/redo, сохранённые проекты и снимки.
   Снимки удалённых проектов тоже вычищаются.

## Команды

```bash
npm ci                      # зависимости (Node 22.5+, проверено на Node 24)
npm test                    # 94 теста
npm run test:ui             # сборка + Playwright E2E с реальным PDF
npm run smoke               # смоук интерфейса (happy-dom)
npm run build               # tsc --noEmit + vite build
bash scripts/fetch-tools.sh # platform-35, build-tools 35.0.0, r8.jar
npm run build:apk           # подписанный APK в build/AnOOPlan-<версия>.apk
UNSIGNED_APK=1 npm run build:apk  # выровненный неподписанный APK для CI
npm start                   # локальный сервер: API + сайт на :3001
```

Для сборки APK нужны **JDK 17**, `zip`, `python3` и `node`. `fetch-tools.sh` скачивает только
Android-инструменты; JDK на VPS уже установлен. Если `keystore/` нет, обычная сборка остановится:
ключ не должен генерироваться случайно. Первая локальная сборка без ключа:
`ALLOW_NEW_KEYSTORE=1 bash scripts/build-apk.sh` — создаст новый ключ и `keystore/pass.txt`.
Для существующего продукта это означает новую подпись и переустановку у пользователей.

Сборка на VPS уже подготовлена: JDK 17, Android SDK в `/root/android-sdk`, build-tools 35 в
`tools/build-tools/35.0.0`, platform jar в `tools/android.jar`, AVD `AnOOPlan35`, Chromium Playwright
в `~/.cache/ms-playwright`. `adb` — `/root/android-sdk/platform-tools/adb`.

## CI и релиз

- `.github/workflows/android-apk.yml` — на каждый push в `main`: `npm ci`, тесты, смоук, E2E,
  **неподписанный** APK (`AnOOPlan-apk-unsigned`). Ключ в раннере не создаётся.
- `.github/workflows/deploy.yml` — GitHub Pages.
- `.github/workflows/android-release.yml` — по тегу `v*`: тесты, смоук, E2E, подписанный APK
  из GitHub Secrets, проверка SHA-256 сертификата, GitHub Release, удаление keystore с раннера.

Порядок релиза:

1. Поднять версию в `package.json`, `android/AndroidManifest.xml` (`versionName`, `versionCode`)
   и `scripts/build-apk.sh` (`VERSION_NAME`, `VERSION_CODE`).
2. Обновить `README.md` и этот файл, прогнать `npm test`, `npm run smoke`, `npm run test:ui`, `npm run build`.
3. Закоммитить и запушить `main`; дождаться зелёного CI.
4. Поставить аннотированный тег `vX.Y.Z` и запушить его — релиз соберёт workflow.
5. Проверить, что в GitHub Release приложен APK и сертификат совпал с `ANDROID_CERT_SHA256`.

Локальная подпись: `KS_PASS=... bash scripts/build-apk.sh` или пароль из `keystore/pass.txt`.
Не коммитить `keystore/`, `build/`, `tools/`, `android/assets/`, `.env` и любые токены.

## Данные, хранение и диагностика

- Проекты: `localStorage` `cableplan:projects`; черновик — `cableplan:autosave`.
- PDF и фото: IndexedDB `cableplan`, хранилище `pdfs`; PDF — ключ без префикса, фото — `photo:<key>`.
- Снимки: хранилище `snapshots`, ключ `<projectId>:<timestamp>`, максимум 20 на проект.
- Диагностика: `cableplan:diagnostics`, до 50 записей, экспорт в текстовый файл.
- GC запускается через 3 секунды после изменений и учитывает undo/redo и снимки. Поэтому старый блоб
  может оставаться, пока на него ссылается история; это защита undo, а не утечка. После перезапуска
  приложения история очищается, и сироты удаляются, если на них не ссылаются снимки.
- `schemaVersion` пока только `1`. Миграций нет: перед облачной синхронизацией нужен слой
  `v1 → v2 → …`, иначе старые проекты перестанут открываться.

## Тесты и что ими не покрыто

- 94 юнит-теста: движок, экспорт, PDF, план-SVG, рендер больших листов, фото, GC, IndexedDB,
  localStorage, CSV, многостраничный план, диагностика, миграции схемы, конфигурация Android и релиза.
- `npm run smoke` — happy-dom: интерфейс, автосохранение, CSV/XLSX/PDF, фото, лицензии, диагностика.
- `npm run test:ui` — Playwright с двухстраничным PDF: загрузка, экспорт журнала, проверка подложки
  обоих листов «План» по пикселям. В смоуке PDF.js по-прежнему заглушка, поэтому E2E дополняет его,
  а не заменяет.
- Ручные проверки: калибровка, фото, удаление проекта/этапа, установка APK на эмулятор Android 15.

## Известные проблемы и техдолг

**P0** — открытых нет.

**P1**
- `App.tsx` уже ~936 строк: вынесены история, PDF-подложка, снимки, фото, план-экспорт, CSV, GC.
  Дальше — `usePlanViewport`, панели свойств/сайдбар и оставшиеся эффекты, без одного большого рефакторинга.
- Слой миграций уже есть, но `schemaVersion` пока 1: перед облаком добавить v2 и ревизии сущностей.
- `xlsx` 0.18.5: high без фикса в npm; используется на запись и в тестах, не на чтение чужих файлов.
  Рассмотреть ExcelJS или вендоринг официальной сборки SheetJS.
- Доступность: основные `aria-label`, фокус, reduced-motion и текстовая альтернатива canvas уже учтены;
  `textZoom(100)` по-прежнему игнорирует системный размер шрифта, нет тёмной темы/высокого контраста.
- Память: 12 Мпикс ≈ 48 МБ на канву; для бюджетных телефонов разумнее 6–8 Мпикс с предупреждением.
- Подмножество PT Sans уменьшит APK примерно на 0,6 МБ.
- Реальная проверка WebView 98 не проводилась (тестировали 124); на userdebug-эмуляторе Android 15
  devtools-сокет WebView остаётся доступен даже при `debuggable=false` — это особенность отладочной
  сборки ОС, не APK. На пользовательских сборках отладка выключена.

**P2**
- Векторный план в PDF вместо растра 1600 px.
- Сравнение снимков версий (diff).
- Неиспользуемые стили `.export-menu` в `styles.css`.
- Диагностика: показывать занятое место и версию WebView в интерфейсе, а не только в экспорте.

## Что делать дальше

Подробный план с номерами итераций, объёмом и критериями готовности — в [ROADMAP.md](ROADMAP.md).
Кратко:

1. **1.14.0** — схема v2 и пины-замечания с фото.
2. **1.15.0** — проверка заполнения лотка.
3. **1.16.0** — каталог, цены, смета.
4. **1.17.0** — печатные формы и обмен.
5. **2.0.0** — облако: аккаунты, бэкап, read-only шаринг; real-time — отдельно и позже.

### Kotlin и онлайн: принятые выводы

- **Kotlin-переписывание сейчас не оправдано.** Основные риски — релиз-инженерия, тесты и
  обработка ошибок, а не WebView. Переписывание даст 3–6 месяцев до паритета и вторую кодовую базу.
  Пересматривать, если станет критичным стилус, ежедневные A1/A0 или WebView начнёт блокировать
  развитие. Промежуточный вариант — вынести в Kotlin только растеризацию PDF.
- **Онлайн — поэтапно, не «сервер + real-time» сразу.**
  1. Аккаунты, облачный бэкап и ссылка «только просмотр».
  2. Комментарии/пины и роли — это нужно стройке чаще, чем одновременное движение объектов.
  3. Real-time co-editing на CRDT/op-log — отдельный дорогой этап после миграций и ревизий.
  Офлайн-режим должен остаться полноценным; PDF/фото — в объектное хранилище, не в БД.

## Инфраструктура (VPS)

- VPS: `201.58.151.95`, Ubuntu 24.04 x86_64, 4 vCPU, 8 ГБ RAM, `/dev/kvm`.
- Node 24.19.0 в `/usr/local/lib/nodejs`, `dsh` глобально; `pnpm` 12.
- Веб-интерфейс DSH: `systemctl status dsh-web`, порт 3480, ссылка с токеном — `dsh-link`
  (токен меняется при перезапуске, берётся из `journalctl -u dsh-web`).
- Ключ провайдера — `/etc/dsh/env` (0600), подключается через `EnvironmentFile`.
- Android: JDK 17, SDK в `/root/android-sdk`, AVD `AnOOPlan35` (Android 15), Chromium Playwright
  установлен; `adb` в `/root/android-sdk/platform-tools`.
- Для чистой сборки: `git clone`, `npm ci`, `bash scripts/fetch-tools.sh`, тесты, `build-apk.sh`.
  Keystore на VPS уже есть; в новом окружении без него подпись не восстановить — нужен архив ключа
  и `keystore/pass.txt` от владельца.

## Правила для новой сессии

- Начинать с чтения этого файла и `README.md`, затем `npm ci && npm test && npm run smoke`.
- **Не коммитить**: `keystore/`, `tools/`, `build/`, `android/assets/`, ключи, токены, `.env`.
- Перед пушем: тесты + смоук зелёные, версия поднята, README и HANDOFF обновлены.
- Релиз — только через тег `vX.Y.Z` и `android-release.yml`; достаточно GitHub Release.
- Не менять политику устройства (DSHA) и не пытаться обойти блокировки доступа.
- Секреты (токен GitHub, ключ DeepSeek, пароль keystore) приходят отдельно; в файлы репозитория
  их не писать.
- Если код расходится с этим документом — сначала проверить факты в коде, затем обновить документ.

## Первые шаги в новой сессии

1. Клонировать репозиторий, `git checkout main`.
2. `npm ci && npm test && npm run smoke` — убедиться, что база зелёная.
3. `bash scripts/fetch-tools.sh && bash scripts/build-apk.sh` — собрать APK локально
   (на VPS keystore уже на месте).
4. Взять следующую итерацию: схема v2 и пины-замечания; затем проверка заполнения лотка.
