# dsh-github-tools

GitHub-инструменты для DSH на `fetch`, без octokit.

| Инструмент | Что делает |
|---|---|
| `github_release` | Релиз по тегу/latest: активы, размеры, draft/prerelease. |
| `github_release_upload` | Загрузка файла в релиз (нужен `GH_TOKEN`/`GITHUB_TOKEN` с contents:write). |
| `github_workflow_runs` | Последние Actions-запуски с выводом и длительностью. |
| `github_issues` | Issues (PR исключаются). |

Публичное чтение работает без токена; для загрузки токен обязателен и читается
только из окружения. Установка — `node dsh/install.mjs`, проверка —
`node dsh/plugins/dsh-github-tools/selftest.mjs`.
