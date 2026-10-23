#!/usr/bin/env bash
# Готовит tools/android.jar (SDK platform 35), tools/build-tools/35.0.0 (aapt, zipalign,
# apksigner, d8) и tools/r8.jar для сборки APK без Gradle.
#
# Версии можно переопределить:
#   SDK_PLATFORM=35 BUILD_TOOLS_VERSION=35.0.0 bash scripts/fetch-tools.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="$ROOT/tools"
PLATFORM="${SDK_PLATFORM:-35}"
BT_VERSION="${BUILD_TOOLS_VERSION:-35.0.0}"
BT_MAJOR="${BT_VERSION%%.*}"
BT_DIR="$TOOLS/build-tools/$BT_VERSION"
PLATFORM_ZIP_URL="${PLATFORM_ZIP_URL:-https://dl.google.com/android/repository/platform-${PLATFORM}_r02.zip}"
PLATFORM_ZIP_FALLBACK="https://mirrors.cloud.tencent.com/AndroidSDK/platform-${PLATFORM}_r02.zip"
BUILD_TOOLS_ZIP_URL="${BUILD_TOOLS_ZIP_URL:-https://dl.google.com/android/repository/build-tools_r${BT_MAJOR}_linux.zip}"
R8_URL="${R8_URL:-https://dl.google.com/dl/android/maven2/com/android/tools/r8/8.5.35/r8-8.5.35.jar}"

mkdir -p "$TOOLS"
cd "$TOOLS"

# Платформа: android.jar нужен и aapt, и javac. Маркер не даёт оставить старую
# платформу (34) после обновления скрипта.
if [ ! -f android.jar ] || [ ! -f ".platform-${PLATFORM}" ]; then
    echo "==> Скачиваю SDK platform ${PLATFORM}"
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    if ! curl -fL --retry 2 -o "$tmp/platform.zip" "$PLATFORM_ZIP_URL"; then
        echo "==> dl.google.com недоступен, пробую зеркало"
        curl -fL --retry 2 -o "$tmp/platform.zip" "$PLATFORM_ZIP_FALLBACK"
    fi
    unzip -q -o "$tmp/platform.zip" -d "$tmp"
    found="$(find "$tmp" -maxdepth 3 -name android.jar | head -1)"
    [ -n "$found" ] || { echo "В архиве нет android.jar" >&2; exit 1; }
    cp "$found" android.jar
    touch ".platform-${PLATFORM}"
    ls -lh android.jar
fi

# Официальные build-tools 35: aapt/zipalign/apksigner/d8 одной версии.
if [ ! -x "$BT_DIR/aapt" ]; then
    echo "==> Скачиваю build-tools ${BT_VERSION}"
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    curl -fL --retry 2 -o "$tmp/build-tools.zip" "$BUILD_TOOLS_ZIP_URL"
    unzip -q -o "$tmp/build-tools.zip" -d "$tmp"
    found="$(find "$tmp" -maxdepth 3 -name aapt | head -1)"
    [ -n "$found" ] || { echo "В архиве нет aapt" >&2; exit 1; }
    rm -rf "$BT_DIR"
    mkdir -p "$BT_DIR"
    cp -a "$(dirname "$found")/." "$BT_DIR/"
fi

if [ ! -f r8.jar ] || ! unzip -t r8.jar >/dev/null 2>&1; then
    echo "==> Скачиваю R8 (d8) для dex"
    curl -fL --retry 2 -o r8.jar "$R8_URL"
    unzip -t r8.jar >/dev/null || { echo "r8.jar повреждён" >&2; exit 1; }
fi

echo "==> Версии инструментов"
"$BT_DIR/aapt" version
"$BT_DIR/apksigner" --version
"$BT_DIR/d8" --version 2>/dev/null | head -1 || true
ls -lh android.jar r8.jar
echo "Инструменты готовы: platform ${PLATFORM}, build-tools ${BT_VERSION}."
