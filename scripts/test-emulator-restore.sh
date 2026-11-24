#!/usr/bin/env bash
# E2E «сбой → восстановление» на эмуляторе (3.1.0):
#   1) чистая установка приложения;
#   2) ожидание готовности: первый автосейв в localStorage;
#   3) правка проекта (оборудование ставится на план) → автосейв пишет черновик;
#   4) force-stop — имитация сбоя: onPause/onDestroy не вызываются;
#   5) повторный запуск — приложение обязано восстановить черновик: восстановление
#      фиксируется записью autosave-restore в полевой диагностике (localStorage).
# Проверка — на уровне данных (adb root, leveldb): uiautomator не видит текст WebView.
# Запуск: bash scripts/test-emulator-restore.sh [путь-к-apk]
# Требования: эмулятор с adb root (google_apis userdebug), adb в PATH или в $ADB.
#
# Тонкости (набиты на 3.1.0): MSYS конвертирует пути устройства в Windows-пути
# (нужен MSYS_NO_PATHCONV=1); grep -q в пайпе под pipefail возвращает 141 по SIGPIPE
# от tr/cat — поэтому дамп читается в переменную и сравнивается подстрокой;
# bash сам выбрасывает NUL-байты из $(...), UTF-16LE localStorage читается нормально.
set -euo pipefail

export MSYS_NO_PATHCONV=1

ADB="${ADB:-adb}"
command -v "$ADB" >/dev/null 2>&1 || ADB=/c/Users/x4k3r/devtools/android-sdk/platform-tools/adb.exe
PKG="com.anooplan.app"
APK="${1:-}"
SCREEN_X=540   # центр плана 1080×2400
SCREEN_Y=1100
TOOL_X=530     # кнопка «Оборудование» в нижней панели
TOOL_Y=2122
LVL='/data/data/com.anooplan.app/app_webview/Default/Local Storage/leveldb'

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
fail() { echo "E2E FAIL: $1" >&2; exit 1; }

# ANDROID_SERIAL — стандартное соглашение adb: с несколькими эмуляторами выбираем цель явно.
DEVICE="${ANDROID_SERIAL:-$("$ADB" devices | awk 'NR>1 && $2=="device" {print $1; exit}')}"
[ -n "$DEVICE" ] || fail "эмулятор/устройство не найдено (adb devices)"
ADB_CMD=("$ADB" -s "$DEVICE")

"${ADB_CMD[@]}" root >/dev/null 2>&1 || fail "adb root недоступен: нужен userdebug-образ эмулятора"
"${ADB_CMD[@]}" wait-for-device
sleep 2   # adbd перезапускается под root

leveldb_has() {
  local dump
  dump="$("${ADB_CMD[@]}" shell "cat '$LVL'/*.log '$LVL'/*.ldb 2>/dev/null" || true)"
  [[ "$dump" == *"$1"* ]]
}

# Системный ANR-диалог («Pixel Launcher isn't responding») модален и съедает тапы —
# на нагруженном эмуляторе всплывает неоднократно (два FAIL 3.1.0 до этой правки).
# WebView-текст uiautomator не видит (NAF), а нативные диалоги — видит: жмём «Wait».
dismiss_anr() {
  "${ADB_CMD[@]}" shell uiautomator dump /sdcard/__ui.xml >/dev/null 2>&1 || true
  local xml b x1 y1 x2 y2
  xml="$("${ADB_CMD[@]}" shell cat /sdcard/__ui.xml 2>/dev/null || true)"
  [[ "$xml" == *"responding"* || "$xml" == *"отвечает"* ]] || return 0
  b="$(printf '%s' "$xml" | sed -n 's/.*text="\(Wait\|Подождать\)"[^>]*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\2 \3 \4 \5/p' | head -1)"
  [ -n "$b" ] || return 0
  read -r x1 y1 x2 y2 <<<"$b"
  "${ADB_CMD[@]}" shell input tap $(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 ))
  sleep 1
}

wait_for() { # wait_for <подстрока> <секунд> <что ждём>
  local deadline=$((SECONDS + $2))
  while [ $SECONDS -lt $deadline ]; do
    dismiss_anr
    leveldb_has "$1" && return 0
    sleep 3
  done
  fail "$3"
}

if [ -n "$APK" ]; then
  say "1/7 Установка $APK"
  APK_LOCAL="$APK"
  command -v cygpath >/dev/null 2>&1 && APK_LOCAL="$(cygpath -m "$APK")"
  "${ADB_CMD[@]}" install -r "$APK_LOCAL" >/dev/null
fi

say "2/7 Чистый старт: данные приложения стёрты"
"${ADB_CMD[@]}" shell pm clear "$PKG" >/dev/null
"${ADB_CMD[@]}" shell am force-stop "$PKG"
"${ADB_CMD[@]}" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1

say "3/7 Ожидание готовности приложения (первый автосейв)"
# Холодный старт после pm clear занимает заметное время: пока страница не загрузилась,
# нажатия попадают в пустоту. Признак готовности — первая запись cableplan:autosave.
wait_for 'cableplan:autosave' 300 "приложение не записало первый автосейв — не дождалось загрузки"

say "4/7 Правка проекта: инструмент «Оборудование» + точка на плане"
dismiss_anr
"${ADB_CMD[@]}" shell input tap $TOOL_X $TOOL_Y
sleep 1
dismiss_anr
"${ADB_CMD[@]}" shell input tap $SCREEN_X $SCREEN_Y
# Автосейв срабатывает через 800 мс после изменения; ждём оборудование E1 в черновике.
wait_for '"number":"E1"' 300 "в черновике нет оборудования E1 — правка не зафиксирована"

say "5/7 Имитация сбоя: force-stop"
"${ADB_CMD[@]}" shell am force-stop "$PKG"
sleep 2

say "6/7 Повторный запуск"
"${ADB_CMD[@]}" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1

say "7/7 Проверка восстановления черновика"
wait_for 'autosave-restore' 300 "запись autosave-restore не найдена: черновик не восстановлен"
echo "E2E PASS: после сбоя черновик восстановлен (запись autosave-restore в диагностике)"
