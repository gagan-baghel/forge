"""Regenerate the Forge app icon master.

The original icons drew the mark at ~110px inside a 512px transparent canvas,
so macOS scaled the *canvas* to fit and the visible mark ended up a speck in the
corner of a white tile. This draws the mark full-bleed at 1024px instead.

Run:  python3 scripts/make_icon.py && pnpm tauri icon src-tauri/icons/icon.png
"""

from PIL import Image, ImageDraw

CANVAS = 1024
# Apple's macOS app-icon grid: the shape occupies 824 of the 1024 canvas, the
# rest is the shadow gutter every native icon leaves. Filling the whole canvas
# makes an app look oversized next to Safari and Mail in the Dock.
SHAPE = 824
SS = 2  # supersample factor for edge antialiasing

# The app's own palette (src/styles/globals.css): a warm charcoal plate, the
# cream ink for the anvil, one ember spark.
PLATE_TOP = (38, 35, 31)
PLATE_BOTTOM = (20, 19, 17)
INK = (236, 231, 222)
EMBER = (232, 106, 48)

# The anvil silhouette, in percent of the tile: horn to the left, flat face,
# waist, foot. The same outline, scaled, is the mark in the app and on the
# website (ForgeMark in Shell.tsx, #mark in docs/index.html).
ANVIL = [
    (15, 39), (33, 35), (78, 35), (78, 46.5), (64, 46.5), (58, 53), (58, 61),
    (68, 68), (68, 76), (30, 76), (30, 68), (40, 61), (40, 53), (34, 47.5), (15, 41.5),
]
SPARK = (70, 16, 81, 27)  # left, top, right, bottom


def squircle_mask(size: int, n: float = 5.0) -> Image.Image:
    """Superellipse |x|^n + |y|^n = 1 — the continuous curve Apple uses, which
    reads noticeably rounder in the corners than a plain rounded rectangle."""
    m = Image.new("L", (size, size), 0)
    px = m.load()
    r = size / 2
    for y in range(size):
        v = abs((y + 0.5 - r) / r) ** n
        if v > 1:
            continue
        # Solve for the x half-width at this row instead of testing every pixel.
        half = (1 - v) ** (1 / n) * r
        x0, x1 = int(r - half), int(r + half)
        for x in range(x0, x1):
            px[x, y] = 255
    return m


def gradient(size: int) -> Image.Image:
    g = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(g)
    for i in range(size):
        t = i / (size - 1)
        d.line(
            [(0, i), (size, i)],
            fill=tuple(round(a + (b - a) * t) for a, b in zip(PLATE_TOP, PLATE_BOTTOM)),
        )
    return g


def draw_mark(img: Image.Image, size: int) -> None:
    """The anvil and its spark, sized as a fraction of the tile."""
    d = ImageDraw.Draw(img)
    u = size / 100  # one percent of the tile, so all numbers read as percentages
    d.polygon([(x * u, y * u) for x, y in ANVIL], fill=INK)
    d.rounded_rectangle([v * u for v in SPARK], radius=1.2 * u, fill=EMBER)


def build() -> Image.Image:
    big = SHAPE * SS
    tile = gradient(big)
    draw_mark(tile, big)
    tile.putalpha(squircle_mask(big))
    tile = tile.resize((SHAPE, SHAPE), Image.LANCZOS)

    out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    off = (CANVAS - SHAPE) // 2
    out.paste(tile, (off, off), tile)
    return out


if __name__ == "__main__":
    icon = build()
    # A visibly-empty icon is exactly the bug this script exists to fix, so
    # assert the mark actually covers the tile before overwriting anything.
    bbox = icon.getbbox()
    assert bbox, "icon is fully transparent"
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    assert w > CANVAS * 0.7 and h > CANVAS * 0.7, f"mark only fills {w}x{h} of {CANVAS}"

    icon.save("src-tauri/icons/icon.png")
    print(f"wrote src-tauri/icons/icon.png — art fills {w}x{h} of {CANVAS}")
