#!/usr/bin/env python3
"""Chroma-key pure magenta (#FF00FF) AI assets to transparent PNGs."""

from __future__ import annotations

import argparse
from pathlib import Path

try:
    from PIL import Image
except ImportError as e:
    raise SystemExit("pip install pillow") from e


def key_magenta(im: Image.Image, g_max: int = 90, rb_min: int = 180) -> Image.Image:
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r > 200 and b > 200 and g < g_max:
                px[x, y] = (0, 0, 0, 0)
            elif r > rb_min and b > rb_min and g < 120 and abs(r - b) < 40:
                strength = max(0.0, min(1.0, (90 - g) / 90))
                px[x, y] = (r, g, b, int(a * (1 - strength * 0.95)))
    return im


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", type=Path, required=True, help="Directory of *-magenta.png")
    ap.add_argument("--glob", default="*-magenta.png")
    ap.add_argument("--suffix", default="-magenta", help="Strip this before .png")
    args = ap.parse_args()

    paths = sorted(args.input.glob(args.glob))
    if not paths:
        raise SystemExit(f"no files matching {args.glob} in {args.input}")

    for src in paths:
        out = src.with_name(src.name.replace(args.suffix, "").replace("-magenta", ""))
        if out == src:
            out = src.with_name(src.stem.replace(args.suffix, "") + ".png")
        key_magenta(Image.open(src)).save(out)
        print(f"keyed {src.name} -> {out.name}")


if __name__ == "__main__":
    main()
