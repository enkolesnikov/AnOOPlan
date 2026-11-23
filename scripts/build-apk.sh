#!/usr/bin/env bash
# Сборка APK AnOOPlan без Gradle: aapt (ресурсы) + javac + d8 (dex) + zipalign + apksigner.
#
# Пути к инструментам можно переопределить переменными окружения:
#   ANDROID_JAR  — jar платформы Android (по умолчанию tools/android.jar)
#   AAPT, ZIPALIGN, APKSIGNER, D8_CMD — инструменты (по умолчанию из tools/build-tools/35.0.0)
#   KS_PASS, KS_ALIAS, VERSION_NAME, VERSION_CODE
#   ALLOW_NEW_KEYSTORE=1 — разрешить генерацию ключа (только для первой локальной сборки)
#   UNSIGNED_APK=1 — собрать выровненный, но неподписанный APK (для CI)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT/android"
BUILD_DIR="$ROOT/build"
TOOLS_DIR="$ROOT/tools"
ANDROID_JAR="${ANDROID_JAR:-$TOOLS_DIR/android.jar}"
R8_JAR="${R8_JAR:-$TOOLS_DIR/r8.jar}"
TARGET_SDK="${TARGET_SDK:-35}"
BUILD_TOOLS_DIR="${BUILD_TOOLS_DIR:-$TOOLS_DIR/build-tools/35.0.0}"
if [ -z "${AAPT:-}" ] && [ -x "$BUILD_TOOLS_DIR/aapt" ]; then AAPT="$BUILD_TOOLS_DIR/aapt"; fi
if [ -z "${ZIPALIGN:-}" ] && [ -x "$BUILD_TOOLS_DIR/zipalign" ]; then ZIPALIGN="$BUILD_TOOLS_DIR/zipalign"; fi
if [ -z "${APKSIGNER:-}" ] && [ -x "$BUILD_TOOLS_DIR/apksigner" ]; then APKSIGNER="$BUILD_TOOLS_DIR/apksigner"; fi
AAPT="${AAPT:-aapt}"
ZIPALIGN="${ZIPALIGN:-zipalign}"
APKSIGNER="${APKSIGNER:-apksigner}"
D8_CMD="${D8_CMD:-}"
KEYSTORE="$ROOT/keystore/anooplan.jks"
KS_PASS="${KS_PASS:-}"
KS_PASS_FILE="${KS_PASS_FILE:-$ROOT/keystore/pass.txt}"
if [ -z "$KS_PASS" ] && [ -f "$KS_PASS_FILE" ]; then
    KS_PASS="$(cat "$KS_PASS_FILE")"
fi
KS_ALIAS="${KS_ALIAS:-anooplan}"

PACKAGE="com.anooplan.app"
# Windows (Git Bash/MSYS): node — нативный exe и не понимает пути /c/...;
# cygpath -m даёт C:/... (без обратных слешей — безопасно для JS-строки).
ROOT_NODE="$ROOT"
if command -v cygpath >/dev/null 2>&1; then
    ROOT_NODE="$(cygpath -m "$ROOT")"
fi
# Версия и versionCode берутся из package.json (единый источник, см. HANDOFF):
# androidVersionCode — целое, только растёт при каждом релизе.
VERSION_NAME="${VERSION_NAME:-$(node -e "process.stdout.write(require('${ROOT_NODE}/package.json').version)")}"
VERSION_CODE="${VERSION_CODE:-$(node -e "process.stdout.write(String(require('${ROOT_NODE}/package.json').androidVersionCode))")}"
case "$VERSION_CODE" in
    ''|*[!0-9]*) echo "androidVersionCode в package.json должен быть целым числом (получено: $VERSION_CODE)" >&2; exit 1 ;;
esac
OUT_APK="$BUILD_DIR/AnOOPlan-${VERSION_NAME}.apk"
if [ "${UNSIGNED_APK:-0}" = "1" ]; then
    OUT_APK="$BUILD_DIR/AnOOPlan-${VERSION_NAME}-unsigned.apk"
fi

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Не найдено: $1" >&2; exit 1; }; }

need javac; need java; need jar; need zip; need node; need python3
need "$AAPT"; need "$ZIPALIGN"
[ -f "$ANDROID_JAR" ] || { echo "Нет $ANDROID_JAR — выполните scripts/fetch-tools.sh или задайте ANDROID_JAR" >&2; exit 1; }

# d8 вызываем массивом: в пути до build-tools могут быть пробелы («Рабочий стол»),
# а непроцитированный $D8_CMD резал путь на слова. Env-переопределение D8_CMD
# по-прежнему допускает форму «java -cp ... com.android.tools.r8.D8».
D8_ARR=()
if [ -n "$D8_CMD" ]; then
    read -r -a D8_ARR <<< "$D8_CMD"
elif [ -x "$BUILD_TOOLS_DIR/d8" ]; then
    D8_ARR=("$BUILD_TOOLS_DIR/d8")
elif command -v d8 >/dev/null 2>&1; then
    D8_ARR=(d8)
elif [ -f "$R8_JAR" ]; then
    D8_ARR=(java -cp "$R8_JAR" com.android.tools.r8.D8)
else
    echo "Нет ни d8 в PATH, ни $R8_JAR — выполните scripts/fetch-tools.sh" >&2
    exit 1
fi

say "1/7 Проверка типов и сборка веб-приложения (Vite)"
cd "$ROOT"
[ -d node_modules ] || npm install --no-audit --no-fund
npx tsc --noEmit
npx vite build

say "2/7 Подготовка ассетов"
rm -rf "$ANDROID_DIR/assets"
mkdir -p "$ANDROID_DIR/assets/www"
cp -a "$ROOT/dist/." "$ANDROID_DIR/assets/www/"

say "3/7 Иконки"
python3 "$ROOT/scripts/make-icons.py" >/dev/null

say "4/7 Компиляция ресурсов и манифеста (aapt)"
rm -rf "$BUILD_DIR/gen" "$BUILD_DIR/classes" "$BUILD_DIR/dex"
mkdir -p "$BUILD_DIR/gen" "$BUILD_DIR/classes" "$BUILD_DIR/dex"
"$AAPT" package -f -m \
    -J "$BUILD_DIR/gen" \
    -M "$ANDROID_DIR/AndroidManifest.xml" \
    -S "$ANDROID_DIR/res" \
    -I "$ANDROID_JAR" \
    --min-sdk-version 24 \
    --target-sdk-version "$TARGET_SDK" \
    --version-code "$VERSION_CODE" \
    --version-name "$VERSION_NAME" \
    --rename-manifest-package "$PACKAGE"

say "5/7 Компиляция Java и dex (javac + d8)"
# Пути в @-файле в кавычках: в пути проекта могут быть пробелы («Рабочий стол»),
# а javac разбирает @-файл по пробелам. Кавычки безопасны и на Linux.
find "$ANDROID_DIR/java" -name '*.java' > "$BUILD_DIR/sources.txt"
# Windows: @-файл читает нативный java.exe — и пути внутри, и сам аргумент @...
# должны быть Windows-вида (msys-конверсия на «@/c/...» не срабатывает).
SOURCES_ARG="@$BUILD_DIR/sources.txt"
if command -v cygpath >/dev/null 2>&1; then
    cygpath -m -f "$BUILD_DIR/sources.txt" | sed 's/.*/"&"/' > "$BUILD_DIR/sources.win.txt"
    mv "$BUILD_DIR/sources.win.txt" "$BUILD_DIR/sources.txt"
    SOURCES_ARG="@$(cygpath -m "$BUILD_DIR/sources.txt")"
else
    sed -i 's/.*/"&"/' "$BUILD_DIR/sources.txt"
fi
javac -nowarn -encoding UTF-8 -source 8 -target 8 \
    -bootclasspath "$ANDROID_JAR" \
    -d "$BUILD_DIR/classes" \
    "$SOURCES_ARG"
# d8 каталоги не принимает («Unsupported source file type»): классы упаковываем в JAR —
# так обходим и лимит длины командной строки Windows, и @-файлы с пробелами в путях.
(cd "$BUILD_DIR/classes" && jar cf "$BUILD_DIR/classes.jar" .)
"${D8_ARR[@]}" --release --min-api 24 --lib "$ANDROID_JAR" --output "$BUILD_DIR/dex" "$BUILD_DIR/classes.jar"

say "6/7 Упаковка и выравнивание (aapt + zip + zipalign)"
UNSIGNED="$BUILD_DIR/anooplan-unsigned.apk"
ALIGNED="$BUILD_DIR/anooplan-aligned.apk"
rm -f "$UNSIGNED" "$ALIGNED"
"$AAPT" package -f \
    -M "$ANDROID_DIR/AndroidManifest.xml" \
    -S "$ANDROID_DIR/res" \
    -A "$ANDROID_DIR/assets" \
    -I "$ANDROID_JAR" \
    -F "$UNSIGNED" \
    --min-sdk-version 24 \
    --target-sdk-version "$TARGET_SDK" \
    --version-code "$VERSION_CODE" \
    --version-name "$VERSION_NAME" \
    --rename-manifest-package "$PACKAGE"
( cd "$BUILD_DIR/dex" && zip -q -X -0 "$UNSIGNED" classes.dex )
"$ZIPALIGN" -p -f 4 "$UNSIGNED" "$ALIGNED"

if [ "${UNSIGNED_APK:-0}" = "1" ]; then
    cp "$ALIGNED" "$OUT_APK"
    say "7/7 Неподписанный APK для CI"
    ls -lh "$OUT_APK"
    "$AAPT" dump badging "$OUT_APK" | head -6
    echo "APK не подписан: для установки используйте release-workflow с секретами."
    exit 0
fi

say "7/7 Подпись (apksigner)"
need "$APKSIGNER"
if [ ! -f "$KEYSTORE" ]; then
    if [ "${ALLOW_NEW_KEYSTORE:-0}" != "1" ]; then
        echo "Нет $KEYSTORE. Для первой локальной сборки запустите ALLOW_NEW_KEYSTORE=1 bash scripts/build-apk.sh;" >&2
        echo "в CI ключ должен приходить из секрета, а не генерироваться." >&2
        exit 1
    fi
    mkdir -p "$(dirname "$KEYSTORE")"
    if [ -z "$KS_PASS" ]; then
        KS_PASS="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
    fi
    # Пароль передаётся через окружение, а не аргументом: argv виден другим процессам.
    KS_PASS="$KS_PASS" keytool -genkeypair -v \
        -keystore "$KEYSTORE" \
        -alias "$KS_ALIAS" \
        -keyalg RSA -keysize 2048 -validity 10950 \
        -dname "CN=AnOOPlan, O=AnOOPlan, C=RU" \
        -storepass:env KS_PASS -keypass:env KS_PASS >/dev/null
    printf '%s' "$KS_PASS" > "$KS_PASS_FILE"
    chmod 600 "$KS_PASS_FILE"
    printf 'Keystore: %s\nAlias: %s\nПароль: см. %s (права 0600).\n\nХраните файл и пароль: без них невозможно выпустить обновление приложения.\n' \
        "$KEYSTORE" "$KS_ALIAS" "$KS_PASS_FILE" > "$ROOT/keystore/README.txt"
    echo "Создан новый keystore: $KEYSTORE (пароль записан в $KS_PASS_FILE)"
fi
if [ -z "$KS_PASS" ]; then
    echo "Не задан пароль keystore. Установите KS_PASS или положите пароль в $KS_PASS_FILE." >&2
    exit 1
fi
rm -f "$OUT_APK"
# Пароль не попадает в argv: apksigner читает его из окружения.
KS_PASS="$KS_PASS" "$APKSIGNER" sign \
    --ks "$KEYSTORE" \
    --ks-pass env:KS_PASS \
    --key-pass env:KS_PASS \
    --v1-signing-enabled true \
    --v2-signing-enabled true \
    --v3-signing-enabled true \
    --out "$OUT_APK" \
    "$ALIGNED"
"$APKSIGNER" verify --verbose "$OUT_APK" | sed 's/^/    /'

say "Готово"
ls -lh "$OUT_APK"
# aapt (narrow C++ API на Windows) не открывает пути с кириллицей —
# дамп манифеста делаем по временной ASCII-копии.
DUMP_TMP="${TMPDIR:-/tmp}/anooplan-dump-$$.apk"
if cp "$OUT_APK" "$DUMP_TMP" 2>/dev/null; then
    "$AAPT" dump badging "$DUMP_TMP" | head -6
    rm -f "$DUMP_TMP"
else
    echo "(aapt dump пропущен: не удалось создать ASCII-копию APK)"
fi
