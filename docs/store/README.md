# Store-иконки AnOOPlan

- `anooplan-512.png` — 512×512 RGBA, альфа-канал полностью непрозрачный; подходит для RuStore и Google Play (32-bit PNG).
- `anooplan-1024.png` — 1024×1024 RGBA, мастер для будущих площадок и пересборок.

Иконки собраны из Android adaptive icon (`android/res/drawable/ic_launcher_foreground.xml` и
`ic_launcher_background.xml`), а не апскейлом 192×192. Фон заполняет весь квадрат, без прозрачных
краёв. Палитра: фон `#122936`, сетка `#1A3746`, трасса `#38C6C9`, точки `#FFFFFF`.

Пересобрать:

```bash
python3 scripts/make-store-icons.py
```
