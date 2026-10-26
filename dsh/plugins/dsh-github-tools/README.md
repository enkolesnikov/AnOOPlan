# dsh-github-tools

Дополнение к маркет-плагину `@perrylink/dsh-github`. PR, issues, review и CI даёт
маркет-плагин; здесь только релизные ассеты, которых в нём нет:

| Инструмент | Что делает |
|---|---|
| `github_release` | Релиз по тегу/latest: активы, размеры, draft/prerelease. |
| `github_release_upload` | Загрузка файла в релиз (нужен `GH_TOKEN`/`GITHUB_TOKEN` с contents:write). |

Публичное чтение работает без токена. Токен берётся из `GH_TOKEN`/`GITHUB_TOKEN` окружения,
а если их нет — из DSH credential store (`~/.dsh/.credentials.yaml`, ключ `GITHUB_TOKEN`),
куда его можно вставить через веб-интерфейс DSH (Plugins → GitHub).
`dryRun: true` проверяет токен/релиз/файл без загрузки.

Установка — `node dsh/install.mjs`, проверка —
`node dsh/plugins/dsh-github-tools/selftest.mjs` (загрузка в self-test не вызывается).
