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
4. `onShowFileChooser` открывает системный `ACTION_OPEN_DOCUMENT`, поэтому «Загрузить PDF»
   и «Загрузить JSON» работают без разрешений на хранилище.
5. `NativeBridge.saveFile(name, base64, mime)` пишет экспорт в `Download/AnOOPlan` через
   `MediaStore` (Android 10+); на более старых версиях — во внешний каталог приложения.
6. Оболочка знает состояние документа: `AnOOPlanNative.setDirty(dirty)` приходит из веб-части,
   поэтому «Назад» показывает диалог «Сохранить / Выйти / Отмена», а после
   `window.__anooplanSaveAndExit()` вызывается `exitNow()` и приложение закрывается уже с сохранением.
7. `AnOOPlanNative.vibrate(ms)` даёт тактильный отклик при попадании в привязку и долгом нажатии
   (разрешение `VIBRATE`), а `FLAG_KEEP_SCREEN_ON` не даёт экрану гаснуть во время черчения.
8. Диалоги `alert`/`confirm`/`prompt` переопределены в `WebChromeClient` — это системные диалоги Android;
   числовой `prompt` открывает цифровую клавиатуру.
9. Приложение не запрашивает разрешение `INTERNET`: весь контент локальный, сеть не нужна.

## Логика работы с PDF

Планы PDF читаются из памяти телефона в `IndexedDB` (`idb:<uuid>`), оттуда pdf.js рисует
подложку на `canvas`. Резервная копия JSON выгружает и проекты, и вложенные PDF.

## Сборка

```bash
bash scripts/fetch-tools.sh    # tools/android.jar + tools/r8.jar
bash scripts/build-apk.sh      # build/AnOOPlan-<версия>.apk
```

Проверка результата: `aapt dump badging build/AnOOPlan-1.0.0.apk`, `apksigner verify --verbose`.
