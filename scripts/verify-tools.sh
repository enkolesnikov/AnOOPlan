#!/usr/bin/env bash
# Проверяет SHA-256 инструментов, которыми собирается APK: aapt, zipalign,
# apksigner, d8 и android.jar. Один список пинов на локальную сборку,
# fetch-tools.sh и release-гейт CI — подмена инструмента на раннере видна сразу.
#
# Пути берутся из окружения (их выставляют fetch-tools.sh или workflow):
#   AAPT, ZIPALIGN, APKSIGNER, D8_CMD, ANDROID_JAR
# Переопределить ожидаемые суммы можно только вместе с версией инструментов:
#   VERIFY_TOOLS_ALLOW_CUSTOM=1 — пропустить проверку с предупреждением.
set -euo pipefail

SHA_ANDROID_JAR="4566663c3876e022b4fa4ced8c8697c4ab1688267f090114fd92d027b32e619b"
SHA_AAPT="393c4c87f675f9555c50921fb53be1f3893cacd29f2270c4863e2e3f99583c39"
SHA_APKSIGNER="b47549e373b895ce6ca620d0c7887e674d9615ffa837a86ac601dcfd04adb0f0"
SHA_ZIPALIGN="a205d94a45c8522ca1b571dcbe190df145c818f0a29dfb366e4dd78eef4f56a7"
SHA_D8="b773a721be3d4988dea9660815a9e441b76100e5b0f5c72b5893cfadadc76c6f"

if [ "${VERIFY_TOOLS_ALLOW_CUSTOM:-0}" = "1" ]; then
    echo "verify-tools: проверка SHA пропущена (VERIFY_TOOLS_ALLOW_CUSTOM=1)" >&2
    exit 0
fi

verify() {
    local path="$1" expected="$2" label="$3"
    if [ -z "$path" ]; then
        echo "verify-tools: не задан путь к $label" >&2
        exit 1
    fi
    if [ ! -f "$path" ]; then
        echo "verify-tools: нет $label ($path)" >&2
        exit 1
    fi
    local actual
    actual="$(sha256sum "$path" | awk '{print $1}')"
    if [ "$actual" != "$expected" ]; then
        echo "verify-tools: подмена/повреждение $label" >&2
        echo "  ожидался SHA-256 $expected" >&2
        echo "  получен          $actual" >&2
        exit 1
    fi
    echo "    $label: SHA-256 ok"
}

verify "${AAPT:-}" "$SHA_AAPT" aapt
verify "${ZIPALIGN:-}" "$SHA_ZIPALIGN" zipalign
verify "${APKSIGNER:-}" "$SHA_APKSIGNER" apksigner
verify "${ANDROID_JAR:-}" "$SHA_ANDROID_JAR" android.jar

# D8_CMD может быть путём к бинарнику или командой «java -cp … D8».
# Проверяем только бинарник: обёртка java не даёт стабильного SHA.
if [ -n "${D8_CMD:-}" ] && [ -f "${D8_CMD}" ]; then
    verify "$D8_CMD" "$SHA_D8" d8
else
    echo "    d8: путь не задан бинарником — проверка SHA пропущена" >&2
fi

echo "verify-tools: инструменты совпадают с закреплёнными версиями."
