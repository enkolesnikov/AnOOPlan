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
VERSION_NAME="${VERSION_NAME:-1.15.0}"
VERSION_CODE="${VERSION_CODE:-23}"
OUT_APK="$BUILD_DIR/AnOOPlan-${VERSION_NAME}.apk"
if [ "${UNSIGNED_APK:-0}" = "1" ]; then
    OUT_APK="$BUILD_DIR/AnOOPlan-${VERSION_NAME}-unsigned.apk"
fi

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Не найдено: $1" >&2; exit 1; }; }

need javac; need java; need zip; need node; need python3
need "$AAPT"; need "$ZIPALIGN"
[ -f "$ANDROID_JAR" ] || { echo "Нет $ANDROID_JAR — выполните scripts/fetch-tools.sh или задайте ANDROID_JAR" >&2; exit 1; }

if [ -z "$D8_CMD" ] && [ -x "$BUILD_TOOLS_DIR/d8" ]; then
    D8_CMD="$BUILD_TOOLS_DIR/d8"
fi
if [ -z "$D8_CMD" ]; then
    if command -v d8 >/dev/null 2>&1; then
        D8_CMD="d8"
    elif [ -f "$R8_JAR" ]; then
        D8_CMD="java -cp $R8_JAR com.android.tools.r8.D8"
    else
        echo "Нет ни d8 в PATH, ни $R8_JAR — выполните scripts/fetch-tools.sh" >&2
        exit 1
    fi
fi

say "1/7 Сборка веб-приложения (Vite)"
cd "$ROOT"
[ -d node_modules ] || npm install --no-audit --no-fund
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
find "$ANDROID_DIR/java" -name '*.java' > "$BUILD_DIR/sources.txt"
javac -nowarn -encoding UTF-8 -source 8 -target 8 \
    -bootclasspath "$ANDROID_JAR" \
    -d "$BUILD_DIR/classes" \
    @"$BUILD_DIR/sources.txt"
find "$BUILD_DIR/classes" -name '*.class' > "$BUILD_DIR/classes.txt"
# shellcheck disable=SC2086
$D8_CMD --release --min-api 24 --lib "$ANDROID_JAR" --output "$BUILD_DIR/dex" @"$BUILD_DIR/classes.txt"

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
    keytool -genkeypair -v \
        -keystore "$KEYSTORE" \
        -alias "$KS_ALIAS" \
        -keyalg RSA -keysize 2048 -validity 10950 \
        -dname "CN=AnOOPlan, O=AnOOPlan, C=RU" \
        -storepass "$KS_PASS" -keypass "$KS_PASS" >/dev/null
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
"$APKSIGNER" sign \
    --ks "$KEYSTORE" \
    --ks-pass "pass:$KS_PASS" \
    --key-pass "pass:$KS_PASS" \
    --v1-signing-enabled true \
    --v2-signing-enabled true \
    --v3-signing-enabled true \
    --out "$OUT_APK" \
    "$ALIGNED"
"$APKSIGNER" verify --verbose "$OUT_APK" | sed 's/^/    /'

say "Готово"
ls -lh "$OUT_APK"
"$AAPT" dump badging "$OUT_APK" | head -6
