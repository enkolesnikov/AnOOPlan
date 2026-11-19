# AnOOPlan — память проекта

Стек: Node 24 + TypeScript + Vite; Android-клиент собирается без Gradle (`npm run build:apk` → `build/anooplan-aligned.apk`).
Сборка `npm run build`, тесты `npm test` (node --test). Версия и тег — только по явной задаче.

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
