# Makes textures/bark_pine.webp and textures/bark_spruce.webp: tileable conifer bark, neutral grey so the
# trunk's vertex colour (the pine's grey-to-orange gradient, the spruce's dark brown) tints it in the shader.
# Pine: tall flat plates flaking in thin horizontal layers, deep irregular vertical fissures between them.
# Spruce: small thin irregular scales, rough-edged, each slightly domed, dark gaps between them.
# Run from the repo root: python tools/gen-bark.py
import numpy as np
from PIL import Image

S = 512

def tile_noise(period, seed, w=None):
    r = np.random.default_rng(seed)
    g = r.random((period, period if w is None else w)).astype(np.float32)
    im = Image.fromarray((g * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32) / 255

def voronoi(px, py, seed, warp=0.0, ax=1.0):
    """Tileable jittered-grid Voronoi on noise-warped coordinates; ax stretches distance horizontally
    (ax > 1 makes the cell boundaries run more vertically). Returns F1, F2 and the nearest cell id."""
    r = np.random.default_rng(seed)
    jx, jy = r.random((py, px)), r.random((py, px))
    xs = (np.arange(S) + 0.5) / S
    XX = np.broadcast_to(xs[None, :], (S, S)).copy()
    YY = np.broadcast_to(xs[:, None], (S, S)).copy()
    if warp:
        XX += warp * (tile_noise(16, seed + 101) - 0.5)
        YY += warp * (tile_noise(16, seed + 102) - 0.5)
    cellx = np.floor(XX * px).astype(np.int32)
    celly = np.floor(YY * py).astype(np.int32)
    F1 = np.full((S, S), 9.0, np.float32)
    F2 = np.full((S, S), 9.0, np.float32)
    ID = np.zeros((S, S), np.int32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            cx = (cellx + dx) % px
            cy = (celly + dy) % py
            ptx = (cx + 0.15 + 0.7 * jx[cy, cx]) / px + (cellx + dx) // px
            pty = (cy + 0.15 + 0.7 * jy[cy, cx]) / py + (celly + dy) // py
            d = np.hypot((XX - ptx) * ax, YY - pty).astype(np.float32)
            nearer = d < F1
            F2 = np.minimum(F2, np.where(nearer, F1, d))
            F1 = np.minimum(F1, d)
            ID = np.where(nearer, cy * px + cx, ID)
    return F1, F2, ID

def grey_rgb(a):
    return np.repeat(np.clip(a, 0, 1)[..., None], 3, axis=2)

# --- pine: tall plates, deep fissures, horizontal flaking ---
F1, F2, ID = voronoi(8, 2, 11, warp=0.035, ax=2.6)
tone = np.random.default_rng(12).random(2 * 8).astype(np.float32)
plate = 0.62 + 0.34 * tone[ID]
fibre = tile_noise(160, 13, w=24)                     # stretched vertically: streaks along the trunk
plate *= 0.86 + 0.28 * fibre
plate *= 0.90 + 0.20 * tile_noise(24, 14)
ys = np.arange(S)[:, None] / S
flake = (np.sin(ys * 2 * np.pi * 34 + tile_noise(12, 15) * 7) * 0.5 + 0.5) ** 6
plate *= 1 - 0.16 * flake                             # thin horizontal layers peeling off the plate face
edge = F2 - F1
width = 0.026 + 0.022 * tile_noise(10, 16)            # fissures wider and narrower along their length
crack = np.clip(1 - edge / width, 0, 1) ** 0.75
rim = np.clip(1 - abs(edge - width - 0.012) / 0.016, 0, 1) * 0.10
img = plate * (1 - crack * 0.90) + 0.12 * crack + rim * (1 - crack)
Image.fromarray((grey_rgb(img) * 255).astype(np.uint8)).save('textures/bark_pine.webp', quality=88)

# --- spruce: small thin irregular scales ---
F1, F2, ID = voronoi(32, 24, 21, warp=0.014, ax=1.15)
tone = np.random.default_rng(22).random(24 * 32).astype(np.float32)
plate = 0.68 + 0.26 * tone[ID]
dome = np.clip(1 - F1 / 0.024, 0, 1)                  # each scale lighter in the middle, darker at the rim
plate *= 0.80 + 0.32 * dome
plate *= 0.88 + 0.24 * tile_noise(128, 23)
crack = np.clip(1 - (F2 - F1) / 0.009, 0, 1) ** 0.9   # thin dark gaps
img = plate * (1 - crack * 0.74) + 0.15 * crack
Image.fromarray((grey_rgb(img) * 255).astype(np.uint8)).save('textures/bark_spruce.webp', quality=88)
print('wrote textures/bark_pine.webp, textures/bark_spruce.webp')