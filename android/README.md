# Нативная часть AnOOPlan

Оболочка Android вокруг статической сборки веб-приложения. Собрана **без Gradle** — только
`aapt` (ресурсы и упаковка), `javac`, `d8` (zipalign/apksigner подписывают готовый пакет).

```
android/
├── AndroidManifest.xml              пакет com.anooplan.app, minSdk 24, targetSdk 34
├── assets/www/                      статическая сборка Vite (создаётся сборкой, в git не хранится)
├── java/com/anooplan/app/
│   ├── MainActivity.java            WebView, выбор файла, экспорт на диск, кнопка «Назад»
│   ├── AssetServer.java             отдаёт assets/www по origin https://appassets.local/
│   └── NativeBridge.java            мост AnOOPlanNative.saveFile() → «Загрузки/AnOOPlan»
└── res/                             манифест-тема, строки, иконки (adaptive + PNG)
```

## Как связаны слои

1. `MainActivity` создаёт `WebView` и грузит `https://appassets.local/`.
2. `AssetServer.shouldInterceptRequest` перехватывает этот хост и отдаёт файлы из `assets/www`
   с правильными MIME-типами. Запросы `/api/*` получают 404 — веб-приложение само переключается
   в режим хранения «Браузер» (`staticMode`).
3. Зачем защищённый origin, а не `file://`: на `file://` в WebView недоступны `IndexedDB`
   (хранение PDF-планов) и `crypto.randomUUID()`; `https://` даёт полноценный secure context.
4. `onShowFileChooser` открывает системный `ACTION_OPEN_DOCUMENT`, поэтому «Загрузить PDF»,
   «Загрузить JSON» и фото оборудования (`image/*`) работают без разрешений на хранилище.
5. `src/export-xlsx.ts`, `src/export-pdf.ts` и `src/export-fonts.ts` собирают Excel и PDF прямо
   в WebView (pdf-lib + PT Sans из `src/assets/fonts`), поэтому сервер для экспорта не нужен;
   `NativeBridge.saveFile(name, base64, mime)` пишет готовый файл в `Download/AnOOPlan` через
   `MediaStore` (Android 10+); на более старых версиях — во внешний каталог приложения.
6. Оболочка знает состояние документа: `AnOOPlanNative.setDirty(dirty)` приходит из веб-части,
   поэтому «Назад» показывает диалог «Сохранить / Выйти / Отмена», а после
   `window.__anooplanSaveAndExit()` вызывается `exitNow()` и приложение закрывается уже с сохранением.
7. `AnOOPlanNative.vibrate(ms)` даёт тактильный отклик при попадании в привязку и долгом нажатии
   (разрешение `VIBRATE`), а `FLAG_KEEP_SCREEN_ON` не даёт экрану гаснуть во время черчения.
8. Диалоги `alert`/`confirm`/`prompt` переопределены в `WebChromeClient` — это системные диалоги Android;
   числовой `prompt` открывает цифровую клавиатуру.
9. `PdfPrinter` печатает готовый PDF журнала через `PrintManager`: страницы отдаются спулеру как есть
   (без растеризации), `PdfRenderer` используется только для количества страниц.
10. «📷 Снять» включает режим `capture` у поля выбора файла; на Android 10+ оболочка кладёт снимок
   в MediaStore (`Pictures/AnOOPlan`) и передаёт его камере через `ACTION_IMAGE_CAPTURE`, без FileProvider.
11. Приложение не запрашивает разрешение `INTERNET`: весь контент локальный, сеть не нужна.

## Логика работы с PDF

Планы PDF читаются из памяти телефона в `IndexedDB` (`idb:<uuid>`), оттуда pdf.js рисует
подложку на `canvas`. Резервная копия JSON выгружает и проекты, и вложенные PDF.

## Сборка

```bash
bash scripts/fetch-tools.sh    # tools/android.jar + tools/r8.jar
bash scripts/build-apk.sh      # build/AnOOPlan-<версия>.apk
```

Проверка результата: `aapt dump badging build/AnOOPlan-1.0.0.apk`, `apksigner verify --verbose`.
