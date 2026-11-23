#!/usr/bin/env bash
# Сборка AAB AnOOPlan без Gradle: существующие aapt/javac/d8 + aapt2 + bundletool.
# AAB подписывается ТОЛЬКО отдельным upload key RuStore, не основным ключом APK.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT/android"
BUILD_DIR="$ROOT/build"
TOOLS_DIR="$ROOT/tools"
WORK="$BUILD_DIR/aab"
ANDROID_JAR="${ANDROID_JAR:-$TOOLS_DIR/android.jar}"
R8_JAR="${R8_JAR:-$TOOLS_DIR/r8.jar}"
TARGET_SDK="${TARGET_SDK:-35}"
BUILD_TOOLS_DIR="${BUILD_TOOLS_DIR:-$TOOLS_DIR/build-tools-win/35.0.0}"
BUNDLETOOL="${BUNDLETOOL:-$TOOLS_DIR/bundletool-all-1.18.1.jar}"
UPLOAD_KEYSTORE="${UPLOAD_KEYSTORE:-$ROOT/keystore/rustore/upload.keystore}"
UPLOAD_PASS_FILE="${UPLOAD_PASS_FILE:-$ROOT/keystore/rustore/upload-pass.txt}"
UPLOAD_ALIAS="${UPLOAD_ALIAS:-upload}"
PACKAGE="com.anooplan.app"

# Windows build-tools 35.0.0 и официальный bundletool 1.18.1.
SHA_AAPT2="cbfe5deda5f7074ce47b6f33818b456ee8046a076a11af13e29c837d3c80c564"
SHA_BUNDLETOOL="675786493983787ffa11550bdb7c0715679a44e1643f3ff980a529e9c822595c"

AAPT="${AAPT:-$BUILD_TOOLS_DIR/aapt}"
AAPT2="${AAPT2:-$BUILD_TOOLS_DIR/aapt2.exe}"
D8_CMD="${D8_CMD:-}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Не найдено: $1" >&2; exit 1; }; }
java_path() {
    if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s\n' "$1"; fi
}
native_path() {
    # aapt/aapt2 на Windows не принимают кириллицу; короткий 8.3-путь содержит только ASCII.
    if command -v cygpath >/dev/null 2>&1; then cygpath -d "$1"; else printf '%s\n' "$1"; fi
}
verify_sha() {
    local path="$1" expected="$2" label="$3" actual
    [ -f "$path" ] || { echo "Нет $label: $path" >&2; exit 1; }
    actual="$(sha256sum "$path" | awk '{print $1}')"
    [ "$actual" = "$expected" ] || {
        echo "Подмена/повреждение $label: ожидался $expected, получен $actual" >&2
        exit 1
    }
    echo "    $label: SHA-256 ok"
}

need java; need javac; need jar; need jarsigner; need node; need python3; need unzip; need sha256sum
need "$AAPT"; need "$AAPT2"
[ -f "$ANDROID_JAR" ] || { echo "Нет $ANDROID_JAR" >&2; exit 1; }
[ -f "$UPLOAD_KEYSTORE" ] || { echo "Нет upload key: $UPLOAD_KEYSTORE" >&2; exit 1; }
if [ "${VERIFY_AAB_TOOLS_ALLOW_CUSTOM:-0}" != "1" ]; then
    verify_sha "$AAPT2" "$SHA_AAPT2" aapt2
    verify_sha "$BUNDLETOOL" "$SHA_BUNDLETOOL" bundletool
else
    echo "Проверка SHA AAB-инструментов пропущена (VERIFY_AAB_TOOLS_ALLOW_CUSTOM=1)" >&2
fi

if [ -z "${UPLOAD_PASS:-}" ] && [ -f "$UPLOAD_PASS_FILE" ]; then
    UPLOAD_PASS="$(cat "$UPLOAD_PASS_FILE")"
fi
[ -n "${UPLOAD_PASS:-}" ] || { echo "Задайте UPLOAD_PASS или UPLOAD_PASS_FILE" >&2; exit 1; }
export UPLOAD_PASS

ROOT_NODE="$ROOT"
if command -v cygpath >/dev/null 2>&1; then ROOT_NODE="$(cygpath -m "$ROOT")"; fi
VERSION_NAME="${VERSION_NAME:-$(node -e "process.stdout.write(require('${ROOT_NODE}/package.json').version)")}"
VERSION_CODE="${VERSION_CODE:-$(node -e "process.stdout.write(String(require('${ROOT_NODE}/package.json').androidVersionCode))")}"
case "$VERSION_CODE" in
    ''|*[!0-9]*) echo "androidVersionCode должен быть целым: $VERSION_CODE" >&2; exit 1 ;;
esac
OUT_AAB="$BUILD_DIR/AnOOPlan-${VERSION_NAME}.aab"

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
    echo "Не найден d8 или $R8_JAR" >&2
    exit 1
fi

say "1/7 Проверка типов и сборка веб-приложения"
cd "$ROOT"
[ -d node_modules ] || npm install --no-audit --no-fund
npx tsc --noEmit
npx vite build

say "2/7 Иконки и рабочие каталоги"
rm -rf "$WORK"
mkdir -p "$WORK/gen" "$WORK/classes" "$WORK/dex"
python3 "$ROOT/scripts/make-icons.py" >/dev/null

say "3/7 Компиляция Java и DEX"
"$AAPT" package -f -m \
    -J "$WORK/gen" \
    -M "$ANDROID_DIR/AndroidManifest.xml" \
    -S "$ANDROID_DIR/res" \
    -I "$(native_path "$ANDROID_JAR")" \
    --min-sdk-version 24 --target-sdk-version "$TARGET_SDK" \
    --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
    --rename-manifest-package "$PACKAGE"
find "$ANDROID_DIR/java" -name '*.java' > "$WORK/sources.txt"
SOURCES_ARG="@$WORK/sources.txt"
if command -v cygpath >/dev/null 2>&1; then
    cygpath -m -f "$WORK/sources.txt" | sed 's/.*/"&"/' > "$WORK/sources.win.txt"
    mv "$WORK/sources.win.txt" "$WORK/sources.txt"
    SOURCES_ARG="@$(cygpath -m "$WORK/sources.txt")"
else
    sed -i 's/.*/"&"/' "$WORK/sources.txt"
fi
javac -nowarn -encoding UTF-8 -source 8 -target 8 \
    -bootclasspath "$(java_path "$ANDROID_JAR")" \
    -d "$WORK/classes" "$SOURCES_ARG"
(cd "$WORK/classes" && jar cf "$WORK/classes.jar" .)
"${D8_ARR[@]}" --release --min-api 24 --lib "$(java_path "$ANDROID_JAR")" \
    --output "$WORK/dex" "$WORK/classes.jar"

say "4/7 Ресурсы AAB в proto-формате"
WORK_NATIVE="$(native_path "$WORK")"
COMPILED_NATIVE="$WORK_NATIVE\\compiled-res.zip"
LINKED_NATIVE="$WORK_NATIVE\\base-proto.apk"
"$AAPT2" compile --dir "$(native_path "$ANDROID_DIR/res")" -o "$COMPILED_NATIVE"
"$AAPT2" link --proto-format -o "$LINKED_NATIVE" \
    -I "$(native_path "$ANDROID_JAR")" \
    --manifest "$(native_path "$ANDROID_DIR/AndroidManifest.xml")" \
    --min-sdk-version 24 --target-sdk-version "$TARGET_SDK" \
    --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
    "$COMPILED_NATIVE"

say "5/7 Base module"
mkdir -p "$WORK/proto" "$WORK/module/manifest" "$WORK/module/assets/www" "$WORK/module/dex"
unzip -q "$WORK/base-proto.apk" -d "$WORK/proto"
cp "$WORK/proto/AndroidManifest.xml" "$WORK/module/manifest/AndroidManifest.xml"
cp "$WORK/proto/resources.pb" "$WORK/module/resources.pb"
cp -a "$WORK/proto/res" "$WORK/module/res"
cp -a "$ROOT/dist/." "$WORK/module/assets/www/"
cp "$WORK/dex/classes.dex" "$WORK/module/dex/classes.dex"
python3 "$ROOT/scripts/pack-aab-module.py" "$WORK/module" "$WORK/base-module.zip"

say "6/7 AAB и подпись upload key"
UNSIGNED_AAB="$WORK/AnOOPlan-${VERSION_NAME}-unsigned.aab"
BUNDLETOOL_WIN="$(java_path "$BUNDLETOOL")"
java -jar "$BUNDLETOOL_WIN" build-bundle \
    --modules="$(java_path "$WORK/base-module.zip")" \
    --output="$(java_path "$UNSIGNED_AAB")"
rm -f "$OUT_AAB"
jarsigner -keystore "$(java_path "$UPLOAD_KEYSTORE")" -storetype JKS \
    -storepass:env UPLOAD_PASS -keypass:env UPLOAD_PASS \
    -sigalg SHA256withRSA -digestalg SHA-256 \
    -signedjar "$(java_path "$OUT_AAB")" "$(java_path "$UNSIGNED_AAB")" "$UPLOAD_ALIAS"
jarsigner -verify -certs "$(java_path "$OUT_AAB")"

say "7/7 Проверка AAB"
java -jar "$BUNDLETOOL_WIN" validate --bundle="$(java_path "$OUT_AAB")"
AAB_SIZE="$(stat -c%s "$OUT_AAB")"
[ "$AAB_SIZE" -le 5368709120 ] || { echo "AAB больше 5 ГБ" >&2; exit 1; }
ls -lh "$OUT_AAB"
sha256sum "$OUT_AAB"
echo "Готово: $OUT_AAB"
