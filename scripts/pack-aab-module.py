#!/usr/bin/env python3
"""Pack an AAB base module without JAR-only META-INF entries."""

from pathlib import Path
import sys
import zipfile


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: pack-aab-module.py <module-dir> <output.zip>")

    root = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve()
    if not root.is_dir():
        raise SystemExit(f"Module directory does not exist: {root}")

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w") as archive:
        for path in sorted(item for item in root.rglob("*") if item.is_file()):
            relative = path.relative_to(root).as_posix()
            if relative.upper().startswith("META-INF/"):
                continue
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())


if __name__ == "__main__":
    main()
