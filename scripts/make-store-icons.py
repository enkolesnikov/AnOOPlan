#!/usr/bin/env python3
"""Собирает store-иконки AnOOPlan из параметров adaptive icon (viewport 108)."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs/store'
BG = '#122936'
GRID = '#1A3746'
ROUTE = '#38C6C9'
WHITE = '#FFFFFF'
SIZE = 4096
SCALE = SIZE / 108
WIDTH = 6 * SCALE
GRID_WIDTH = 0.8 * SCALE


def s(value: float) -> float:
    return value * SCALE


def dot(draw: ImageDraw.ImageDraw, x: float, y: float, radius: float, color: str) -> None:
    draw.ellipse((s(x - radius), s(y - radius), s(x + radius), s(y + radius)), fill=color)


image = Image.new('RGBA', (SIZE, SIZE), BG)
draw = ImageDraw.Draw(image)

for offset in range(12, 108, 12):
    draw.line((s(offset), 0, s(offset), SIZE), fill=GRID, width=round(GRID_WIDTH))
    draw.line((0, s(offset), SIZE, s(offset)), fill=GRID, width=round(GRID_WIDTH))

points = [(36, 74), (36, 40), (70, 40), (70, 66)]
draw.line([(s(x), s(y)) for x, y in points], fill=ROUTE, width=round(WIDTH), joint='curve')
for x, y in points:
    dot(draw, x, y, 3, ROUTE)

dot(draw, 36, 74, 5.1, WHITE)
dot(draw, 70, 66, 5.1, WHITE)
dot(draw, 36, 74, 2.0, BG)
dot(draw, 70, 66, 2.0, BG)

OUT.mkdir(parents=True, exist_ok=True)
for size in (1024, 512):
    image.resize((size, size), Image.Resampling.LANCZOS).save(OUT / f'anooplan-{size}.png', optimize=True)
print('written:', *(str(p) for p in sorted(OUT.glob('*.png'))))
