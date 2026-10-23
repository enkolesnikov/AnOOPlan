#!/usr/bin/env python3
"""Генерация растровых иконок AnOOPlan (adaptive icon + legacy PNG) без внешних зависимостей."""
import os
import struct
import zlib

BG = (18, 41, 54)          # #122936
BG_LINE = (26, 55, 70)     # линии «сетки плана»
ROUTE = (56, 198, 201)     # #38C6C9 — кабельная трасса
NODE = (255, 255, 255)
NODE_CORE = (18, 41, 54)

# Геометрия в нормализованных координатах (0..1), как в векторной adaptive-иконке.
ROUTE_POINTS = [(0.333, 0.685), (0.333, 0.370), (0.648, 0.370), (0.648, 0.611)]
ROUTE_HALF_WIDTH = 0.028
NODES = [(0.333, 0.685), (0.648, 0.611)]
NODE_RADIUS = 0.058
NODE_CORE_RADIUS = 0.022
GRID_STEP = 0.111
GRID_HALF_WIDTH = 0.0035


def sd_round_box(px, py, cx, cy, half, radius):
    qx = abs(px - cx) - (half - radius)
    qy = abs(py - cy) - (half - radius)
    ax, ay = max(qx, 0.0), max(qy, 0.0)
    return (ax * ax + ay * ay) ** 0.5 + min(max(qx, qy), 0.0) - radius


def sd_circle(px, py, cx, cy, radius):
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5 - radius


def sd_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    t = 0.0 if length_sq == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
    return ((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2) ** 0.5


def coverage(distance_px):
    return max(0.0, min(1.0, 0.5 - distance_px))


def blend(dst, src, alpha):
    return tuple(int(round(d + (s - d) * alpha)) for d, s in zip(dst, src))


def render(size, round_icon):
    pixels = []
    route_path = [(x * size, y * size) for x, y in ROUTE_POINTS]
    node_list = [(x * size, y * size) for x, y in NODES]
    half = size / 2.0

    for y in range(size):
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            if round_icon:
                base_shape = sd_circle(px, py, half, half, half - 0.5)
            else:
                base_shape = sd_round_box(px, py, half, half, half - 0.5, size * 0.22)
            base_alpha = coverage(base_shape)

            if base_alpha <= 0.0:
                pixels.append((0, 0, 0, 0))
                continue
            color = BG

            # Сетка плана внутри подложки.
            grid_distance = min(
                min((px % (size * GRID_STEP)), size * GRID_STEP - (px % (size * GRID_STEP))),
                min((py % (size * GRID_STEP)), size * GRID_STEP - (py % (size * GRID_STEP))),
            )
            grid_alpha = coverage(grid_distance - GRID_HALF_WIDTH) * 0.55
            if grid_alpha > 0:
                color = blend(color, BG_LINE, grid_alpha)

            # Кабельная трасса.
            distance = min(
                sd_segment(px, py, *route_path[i], *route_path[i + 1]) for i in range(len(route_path) - 1)
            ) - ROUTE_HALF_WIDTH * size
            route_alpha = coverage(distance)
            if route_alpha > 0:
                color = blend(color, ROUTE, route_alpha)

            # Оборудование на концах трассы.
            for nx, ny in node_list:
                outer = coverage(sd_circle(px, py, nx, ny, NODE_RADIUS * size))
                if outer > 0:
                    color = blend(color, NODE, outer)
                    inner = coverage(sd_circle(px, py, nx, ny, NODE_CORE_RADIUS * size))
                    if inner > 0:
                        color = blend(color, NODE_CORE, inner)

            pixels.append((color[0], color[1], color[2], int(round(base_alpha * 255))))
    return pixels


def write_png(path, size, pixels):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixels[y * size + x])

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    with open(path, "wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n")
        handle.write(chunk(b"IHDR", header))
        handle.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        handle.write(chunk(b"IEND", b""))


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    res = os.path.join(root, "android", "res")
    densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for density, size in densities.items():
        target_dir = os.path.join(res, "mipmap-" + density)
        os.makedirs(target_dir, exist_ok=True)
        write_png(os.path.join(target_dir, "ic_launcher.png"), size, render(size, False))
        write_png(os.path.join(target_dir, "ic_launcher_round.png"), size, render(size, True))
        print("mipmap-{}: ic_launcher.png, ic_launcher_round.png ({}px)".format(density, size))

    store_dir = os.path.join(root, "store")
    os.makedirs(store_dir, exist_ok=True)
    write_png(os.path.join(store_dir, "icon-512.png"), 512, render(512, False))
    write_png(os.path.join(store_dir, "icon-512-round.png"), 512, render(512, True))
    print("store: icon-512.png, icon-512-round.png")


if __name__ == "__main__":
    main()
