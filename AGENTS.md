# AnOOPlan — память проекта

Стек: Node 24 + TypeScript + Vite; Android-клиент собирается без Gradle (`npm run build:apk` → `build/anooplan-aligned.apk`).
Сборка `npm run build`, тесты `npm test` (node --test). Версия и тег — только по явной задаче.

## Релиз: проверенные правила (2.10.0)

- **Перетег — это новый релиз.** Если тег удалён и создан заново (например после красного CI), GitHub
  Release предыдущего прогона становится `untagged` **draft**, и публичная ссылка на APK отдаёт 404.
  После перетега проверять `releases/tags/vX.Y.Z`: `tag_name` = тег, `draft: false`, и скачивание
  `releases/download/vX.Y.Z/AnOOPlan-X.Y.Z.apk` отвечает 200.
- **SHA CI-сборки ≠ SHA локальной.** APK из `android-release.yml` собирается на другом раннере:
  ZIP-таймстампы дают другие байты. В документацию и в релиз писать SHA **скачанного ассета**, а не
  локальной сборки; сверять `sha256sum` скачанного файла с `AnOOPlan-X.Y.Z.apk.sha256`.
- **Абсолютные пороги времени в тестах** (ReDoS/линейность) держать с запасом ×10: локально 2–5 мс,
  на общем раннере 50–80 мс — иначе CI краснеет на ровном месте.

## RuStore: публикация и подпись (с 2026-11-24)

- **RuStore — постоянный канал публикации AnOOPlan.** Для каждой версии, предназначенной RuStore,
  обязательно собирать **AAB**; заменять его APK нельзя. Для GitHub Releases по-прежнему нужен APK.
  Загрузка, модерация и факт публикации в RuStore — отдельные статусы: не считать их выполненными
  без подтверждения владельца или консоли.
- Сборка: `bash scripts/build-aab.sh` → `build/AnOOPlan-<версия>.aab` (aapt2 + bundletool, без Gradle;
  модуль — `scripts/pack-aab-module.py`). Скрипт сам подписывает AAB и запускает `jarsigner -verify`
  и `bundletool validate`. Полный порядок и проверки — `docs/RELEASE.md`, раздел «AAB для RuStore».
- AAB подписывать только `keystore/rustore/upload.keystore`, alias `upload`; пароль —
  `keystore/rustore/upload-pass.txt`. Этот upload key сохранять и использовать для всех следующих
  RuStore-версий, не подменять его основным ключом и не создавать заново.
- Основной ключ остаётся `keystore/anooplan.jks`, alias `anooplan`, SHA-256 сертификата
  `6431374cf6a7d385c4c47f0f2bf54fcb5ee5b2c7120f057b18c4062af92fe097`. Не пересоздавать его и не
  использовать `ALLOW_NEW_KEYSTORE=1` для существующего приложения.
- Владелец подтвердил загрузку `keystore/rustore/pepk_out.zip` и `keystore/rustore/uploadcert.pem`
  в RuStore 2026-11-24. Повторно загружать их для новых версий не нужно. Этот статус относится только
  к подписи: загрузка AAB, модерация и публикация приложения им не подтверждаются. Для каждой версии
  нужен свежий AAB. Закрытые ключи и пароли в консоль не загружать. Каталоги `build/`, `tools/` и
  `keystore/` игнорируются Git: их содержимое не коммитить и не отправлять в GitHub.
- Для каждой RuStore-версии в `docs/RELEASE-NOTES-X.Y.Z.md` держать раздел **«Кратко для RuStore»**:
  2–4 понятных пользователю пункта без JavaBridge, DEX, PEPK и других технических деталей.

## Среда на Windows (с 2026-11-23)

- JDK Temurin 21 — `C:\Users\x4k3r\devtools\jdk-21.0.13.1+2`; Android SDK —
  `C:\Users\x4k3r\devtools\android-sdk`; AVD `AnOOPlan35` (Android 15). В `config.ini` AVD
  выставлено `hw.ramSize = 4096M` — с дефолтными 1536M lowmemorykiller убивает renderer WebView,
  и приложение показывает белый экран. Локальная сборка APK работает — команды и тонкости MSYS
  в `docs/HANDOFF.md`, раздел «Сборка APK».
- **Правки `MainActivity`/`NativeBridge` перед релизом проверять на эмуляторе:** баг 3.0.0
  (`webView.getUrl()` с потока JavaBridge → белый экран на Android 15) нашёл только эмулятор,
  юнит-тесты его не ловили.
- Следующая итерация — **3.1.0 «Оболочка и приёмка»**: декомпозиция `MainActivity`, E2E
  «сбой → восстановление» на эмуляторе, скан истории git (S-11). План — `docs/ROADMAP.md`.

## Безопасность

- Текущее состояние и история: [`docs/REPORT-SECURITY.md`](docs/REPORT-SECURITY.md) — открытых алертов CodeQL 0.
  Любая работа по безопасности заканчивается записью в этот отчёт и зелёным CI.
- Постоянные правила сервера (нулевые алерты, секреты, `main-guard`, релизы) — в общей памяти
  `/home/office/.config/opencode/AGENTS.md`, раздел «Безопасность репозиториев».
- После push в `main`: `CI`, `CodeQL`, `Gitleaks` = success, `code-scanning/alerts?state=open` = `[]`.

## Что где

- `server/` — LAN-сервер (Express). Режим LAN включается только с `ANOOPLAN_TOKEN` **не короче 16 символов**;
  без токена сервер отказывается стартовать на не-loopback `HOST` (проекты заказчика иначе доступны всей сети).
  На `127.0.0.1` токен не нужен.
- `dsh/` — dev-инструменты (плагины, установщик, загрузка релизов). **В APK не входит**: в сборку попадает
  только `dist/`, поэтому `server/`, `dsh/`, `.github/`, `tests/`, `docs/` на размер и содержимое APK не влияют.
