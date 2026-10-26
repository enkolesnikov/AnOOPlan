# Чек-лист релиза AnOOPlan

Короткий воспроизводимый порядок выпуска. Полный контекст — [HANDOFF.md](HANDOFF.md),
план версий — [ROADMAP.md](ROADMAP.md). Релиз — **только по аннотированному тегу `v*`**.

## 1. Подготовка

- [ ] `package.json`: `version` = X.Y.Z, `androidVersionCode` +1 (единственный источник).
- [ ] `android/AndroidManifest.xml`: те же `versionName`/`versionCode` (тест сверяет с `package.json`).
- [ ] README «Что нового», HANDOFF (состояние, релиз), ROADMAP (история), ARCHITECTURE — по факту.
- [ ] Новые поля модели — только необязательные; миграция нормализует мусор; API отклоняет 0/отрицательные.
- [ ] Офлайн-контракт: нет `INTERNET`, нет сетевых вызовов и SDK.

## 2. Проверки до коммита

```bash
npm ci                      # lock-файл воспроизводим (см. .npmrc про jsx-a11y)
npm run lint                # 0 ошибок; предупреждения react-hooks/exhaustive-deps допустимы
npx tsc --noEmit
npm test                    # все юнит-тесты
npm run coverage            # строки ≥93 %, ветки ≥85 %, функции ≥92 %
npm run size                # JS ≤460 КБ, CSS ≤40 КБ (нужен свежий dist)
npm run smoke               # happy-dom, все проверки
npm run test:ui             # 2 E2E (собирает dist)
npm run test:visual         # 4 визуальных эталона (вне CI: зависит от шрифтов машины)
npm run knip                # мёртвый код/экспорты — 0 находок
npm audit                   # 0 high
```

Бюджеты: CI на push ≤130 с, APK ≤1,6 МБ, `npm audit` 0 high.

## 3. APK

```bash
bash scripts/build-apk.sh                       # keystore/ и tools/ на VPS, в git не входят
APK=build/AnOOPlan-X.Y.Z.apk
tools/build-tools/35.0.0/aapt dump badging "$APK" | head -1     # versionName/versionCode
tools/build-tools/35.0.0/aapt dump permissions "$APK"            # только VIBRATE, без INTERNET
tools/build-tools/35.0.0/apksigner verify --print-certs "$APK"   # SHA-256 = 6431374c…92fe097
ls -l "$APK"                                                     # ≤1,6 МБ
```

Установка и ручные сценарии на эмуляторе (AVD `AnOOPlan25`, adb `/root/android-sdk/platform-tools/adb`):

```bash
adb install -r build/AnOOPlan-X.Y.Z.apk
adb shell am start -n com.anooplan.app/.MainActivity
adb exec-out screencap -p > build/device-release.png
adb shell settings put system font_scale 1.3      # textZoom без перезапуска
adb shell cmd uimode night yes                    # тёмная тема в WebView (values-night)
```

- [ ] Запуск, открытие демо-проекта, `.anooplan` из файлового менеджера, печать/шаринг.
- [ ] Тёмная тема и крупный шрифт работают в APK (не только в браузере).
- [ ] Скриншоты 1–3 в `build/release-screenshots/` (git не трогаем).

## 4. Git, тег, релиз

- [ ] Коммит и push `main`; дождаться зелёного CI и CodeQL.
- [ ] Аннотированный тег с описанием изменений (оно станет текстом GitHub Release):

```bash
git tag -a vX.Y.Z -F /tmp/tagmsg.txt
git push origin vX.Y.Z        # токен — через GIT_ASKPASS + env GH_TOKEN, не в файлы/git config
```

- [ ] Дождаться `android-release.yml` (workflow_dispatch не нужен: триггер — тег `v*`).
- [ ] В GitHub Release есть `AnOOPlan-X.Y.Z.apk`; скачать и перепроверить сертификат/разрешения.
- [ ] Приложить 1–3 скриншота (workflow загружает только APK):

```bash
UP=$(curl -s -H "Authorization: Bearer $GH_TOKEN" \
  https://api.github.com/repos/enkolesnikov/AnOOPlan/releases/tags/vX.Y.Z \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["upload_url"].split("{")[0])')
curl -s -X POST -H "Authorization: Bearer $GH_TOKEN" -H "Content-Type: image/png" \
  --data-binary @build/release-screenshots/01.png "$UP?name=01.png"
```

- [ ] Обновить HANDOFF: ссылка на релиз, фактическое время CI, проверенный APK; push docs-коммита.

## 5. После релиза

- [ ] `npm run status` — статус проекта.
- [ ] Веб-версию публиковать только вручную (`deploy.yml`), если нужно.
- [ ] Следующая итерация — по ROADMAP; не возвращать облако и фитинги без решения владельца.

## Запрещено коммитить

`keystore/`, `tools/`, `build/`, `android/assets/`, `.env`, токены и pass-файлы.
