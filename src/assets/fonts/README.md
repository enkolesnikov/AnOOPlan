# Шрифты PDF

`AnOOPlanSans-Regular.ttf` и `AnOOPlanSans-Bold.ttf` — **сабсеты** шрифтов PT Sans
(© 2010 ParaType Ltd., SIL Open Font License 1.1, полный текст в `OFL.txt`).

- Оставлены глифы: Basic Latin, Latin-1 и Latin Extended-A, кириллица, типографская пунктуация,
  валюты (₽, €), №, стрелки, математические знаки, геометрические фигуры.
- Удалены hinting и лишние таблицы, поэтому каждый файл ≈65 КБ вместо ≈450 КБ.
- OFL требует не использовать Reserved Font Names «PT Sans»/«ParaType» для модифицированных
  версий, поэтому семейство переименовано в **AnOOPlan Sans**. Название PT Sans остаётся
  в лицензиях/атрибуции (см. экран «О программе»).
- Пересборка: `pyftsubset` + переименование name-таблиц (fonttools). Оригинальные файлы доступны
  в истории git до версии 2.1.0.

## Шрифт интерфейса

`MedeoSans-AnOOPlan.woff2` — **сабсет** variable-шрифта Medeo Sans (© 2026 The Medeo Project
Authors, SIL OFL 1.1, полный текст в `Medeo-OFL.txt`). Оставлены Basic Latin, Latin-1,
кириллица, типографская пунктуация, валюты (₽), №, стрелки, математические знаки и маркеры.
Оригинал: `medeo-font@1.0.0-rc.3`, `dist/fonts/medeo-sans/MedeoSansVariable.woff2` (138 КБ);
сабсет — 64,5 КБ. Пересборка: `pyftsubset` с диапазонами из комментария в `styles.css`.
