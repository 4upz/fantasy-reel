"""Outline the approved type treatment; requires fonttools and uharfbuzz."""

import io
import json
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

SOURCE = Path(__file__).resolve().parent


def outline(weight, width):
    font = instantiateVariableFont(
        TTFont(SOURCE / "bricolage.ttf"),
        {"wght": weight, "wdth": width, "opsz": 48},
        inplace=True,
    )
    buffer = io.BytesIO()
    font.save(buffer)
    shaping_font = hb.Font(hb.Face(buffer.getvalue()))
    upem = font["head"].unitsPerEm
    shaping_font.scale = (upem, upem)
    text = hb.Buffer()
    text.add_str("Fantasy Reel")
    text.guess_segment_properties()
    hb.shape(shaping_font, text, {"kern": True})

    glyphs = font.getGlyphSet()
    order = font.getGlyphOrder()
    paths, bounds = SVGPathPen(glyphs), BoundsPen(glyphs)
    x = 0
    for info, position in zip(text.glyph_infos, text.glyph_positions):
        transform = (1, 0, 0, 1, x + position.x_offset, position.y_offset)
        glyph = glyphs[order[info.codepoint]]
        glyph.draw(TransformPen(paths, transform))
        glyph.draw(TransformPen(bounds, transform))
        x += position.x_advance - upem * 0.012
    left, bottom, right, top = bounds.bounds
    return {
        "path": paths.getCommands(),
        "width": right - left,
        "height": top - bottom,
        "transform": f"translate({-left} {top}) scale(1 -1)",
        "axes": {"wght": weight, "wdth": width, "opsz": 48},
    }


if __name__ == "__main__":
    (SOURCE / "wordmarks.json").write_text(
        json.dumps({"regular": outline(700, 96), "compact": outline(750, 88)}, indent=2) + "\n"
    )
