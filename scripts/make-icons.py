#!/usr/bin/env python3
"""Export crisp toolbar PNGs without changing the application's icons.

Requires Pillow (`python3 -m pip install Pillow`). Run from any directory.
Use --include-app explicitly to regenerate app icons from icon-source.png.
"""

import argparse
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "icons"
TOOLBAR_SIZES = (16, 20, 24, 32, 40, 48, 64, 128)
APP_SIZES = (16, 32, 48, 128)


def export(prefix, sizes):
    with Image.open(ROOT / f"{prefix}-source.png") as source:
        artwork = source.convert("RGBA")
        if artwork.width != artwork.height:
            raise ValueError("Icon source must have a square canvas")
        for size in sizes:
            artwork.resize((size, size), Image.Resampling.LANCZOS).save(
                ROOT / f"{prefix}-{size}.png", optimize=True
            )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--include-app", action="store_true")
    args = parser.parse_args()
    if args.include_app and not (ROOT / "icon-source.png").exists():
        parser.error("This extension has no icon-source.png; only toolbar assets can be regenerated.")
    export("toolbar", TOOLBAR_SIZES)
    if args.include_app:
        export("icon", APP_SIZES)


if __name__ == "__main__":
    main()
