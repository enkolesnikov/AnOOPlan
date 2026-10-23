#!/usr/bin/env bash
# Готовит tools/android.jar (SDK platform 34) и tools/r8.jar (d8) для сборки APK без Gradle.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="$ROOT/tools"
PLATFORM_ZIP_URL="${PLATFORM_ZIP_URL:-https://mirrors.cloud.tencent.com/AndroidSDK/platform-34-ext7_r03.zip}"
PLATFORM_ZIP_FALLBACK="https://dl.google.com/android/repository/platform-34-ext7_r03.zip"
R8_URL="${R8_URL:-https://dl.google.com/dl/android/maven2/com/android/tools/r8/8.5.35/r8-8.5.35.jar}"

mkdir -p "$TOOLS"
cd "$TOOLS"

if [ ! -f android.jar ]; then
    echo "==> Скачиваю SDK platform 34"
    if ! curl -fL --retry 2 -o platform-34.zip "$PLATFORM_ZIP_URL"; then
        echo "==> Зеркало недоступно, пробую dl.google.com"
        curl -fL --retry 2 -o platform-34.zip "$PLATFORM_ZIP_FALLBACK"
    fi
    rm -rf platform-34
    unzip -q -o platform-34.zip
    found="$(find . -maxdepth 2 -name android.jar | head -1)"
    [ -n "$found" ] || { echo "В архиве нет android.jar" >&2; exit 1; }
    cp "$found" android.jar
    rm -rf platform-34 platform-34.zip
fi

if [ ! -f r8.jar ] || ! unzip -t r8.jar >/dev/null 2>&1; then
    echo "==> Скачиваю R8 (d8) для dex"
    curl -fL --retry 2 -o r8.jar "$R8_URL"
    unzip -t r8.jar >/dev/null || { echo "r8.jar повреждён" >&2; exit 1; }
fi

ls -lh android.jar r8.jar
echo "Инструменты готовы."
