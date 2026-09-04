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

BRAND = (109, 91, 255)
BRAND_2 = (152, 136, 255)
ACCENT = (255, 209, 102)
WHITE = (255, 255, 255)


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
            fill=tuple(round(a + (b - a) * t) for a, b in zip(BRAND, BRAND_2)),
        )
    return g


def draw_mark(img: Image.Image, size: int) -> None:
    """A blocky F with the accent dot, sized as a fraction of the tile."""
    d = ImageDraw.Draw(img)
    u = size / 100  # one percent of the tile, so all numbers read as percentages
    r = 3 * u       # bar corner radius

    # Centred on the group's own bounding box (stem through dot), not on the
    # stem — optically centring the F alone leaves the tile looking lopsided.
    stem_l, stem_r = 26 * u, 39.5 * u
    top, bottom = 26 * u, 74 * u
    d.rounded_rectangle([stem_l, top, stem_r, bottom], radius=r, fill=WHITE)
    d.rounded_rectangle([stem_l, top, 70 * u, 39 * u], radius=r, fill=WHITE)
    d.rounded_rectangle([stem_l, 46 * u, 60.5 * u, 59 * u], radius=r, fill=WHITE)

    dot_c, dot_r = (68 * u, 67 * u), 6.5 * u
    d.ellipse(
        [dot_c[0] - dot_r, dot_c[1] - dot_r, dot_c[0] + dot_r, dot_c[1] + dot_r],
        fill=ACCENT,
    )


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
