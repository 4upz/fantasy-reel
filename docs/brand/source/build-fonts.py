"""Compress the licensed source fonts without changing glyphs or variable axes."""
from pathlib import Path

from fontTools.ttLib import TTFont

SOURCE = Path(__file__).resolve().parent
OUTPUT = SOURCE.parents[2] / "apps/frontend/app/fonts"

if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name in ("bricolage", "dm-sans"):
        font = TTFont(SOURCE / f"{name}.ttf")
        font.flavor = "woff2"
        font.save(OUTPUT / f"{name}.woff2")
