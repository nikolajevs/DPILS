"""Cuts the game sounds (sounds/*.mp3) out of the source recordings; all of them are CC0, see sounds/README.md.

    python tools/sounds.py <Prepared SFX Library folder> <folder with the Freesound previews> [ffmpeg]

The first folder is "Prepared SFX Library" from The Free Firearm Sound Library (opengameart.org/content/the-free-firearm-sound-library),
the second holds the Freesound previews named <sound id>.mp3 (cdn.freesound.org/previews/...-hq.mp3). ffmpeg: the path of the
program (pip install imageio-ffmpeg gives one), by default `ffmpeg` from PATH. Needs numpy.

Each clip: from just before the attack, of a set length, with a fade at the end, the peak brought to -1 dB. The shots near you are
stereo (they are your own gun), the rest mono: the page pans them itself, to where the sound comes from."""
import os
import subprocess
import sys

import numpy as np

SR = 44100
LIB, FS = sys.argv[1], sys.argv[2]
FF = sys.argv[3] if len(sys.argv) > 3 else 'ffmpeg'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sounds')


def load(path, ch):
    raw = subprocess.run([FF, '-v', 'error', '-i', path, '-ac', str(ch), '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, ch)


def onsets(x, gap=2.0):
    """the starts of the loud events: the 5 ms envelope crosses a quarter of the peak, the next one not sooner than gap s"""
    e = np.convolve(np.abs(x).mean(1), np.ones(SR // 200) / (SR // 200), 'same')
    hot, out, i = e > e.max() * 0.25, [], 0
    while i < len(e):
        if hot[i]:
            out.append(i)
            i += int(gap * SR)
        else:
            i += 1
    return out


def cut(x, start, secs, fade):
    a = max(0, start - int(0.004 * SR))
    y = x[a:a + int(secs * SR)].copy()
    y[:int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))[:, None]   # no click at the start
    n = int(len(y) * fade)
    y[-n:] *= (np.linspace(1, 0, n) ** 2)[:, None]
    if y.shape[1] == 2:   # the microphones stood to one side of the shooter: your own gun should sound in the middle
        r = np.sqrt((y ** 2).mean(0)) + 1e-9
        y *= r.mean() / r
    return y / (np.abs(y).max() + 1e-9) * 10 ** (-1 / 20)


def save(name, y, kbps):
    path = os.path.join(OUT, name + '.mp3')
    subprocess.run([FF, '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(y.shape[1]), '-i', '-', '-c:a', 'libmp3lame', '-b:a', str(kbps) + 'k', path],
                   input=y.astype(np.float32).tobytes(), check=True)
    print(name, y.shape[1], 'ch', round(len(y) / SR, 2), 's', os.path.getsize(path) // 1024, 'KB')


os.makedirs(OUT, exist_ok=True)

# the guns: (name in the game, folder, the file recorded near the shooter, the file recorded farther, seconds near, seconds far)
GUNS = [
    ('ak', 'AK-47', 'C_28P', 'C_31P', 1.3, 2.0),
    ('sg', 'Nova', 'O_21P', 'O_17P', 1.6, 2.2),
    ('sn', 'Tikka', 'W_29P', 'W_24P', 2.2, 3.0),
    ('pi', 'Walther PPQ', 'X_39P', 'X_31P', 1.0, 1.6),
    ('mg', 'AR-15', 'D_32P', 'D_24P', 1.2, 2.0),
]
for name, folder, near, far, sn, sf in GUNS:
    x = load(os.path.join(LIB, folder, near + '.wav'), 2)
    for k, o in enumerate(onsets(x)[:2]):
        save(f'{name}-{k + 1}', cut(x, o, sn, 0.7), 160)
    x = load(os.path.join(LIB, folder, far + '.wav'), 1)
    save(f'{name}-far', cut(x, onsets(x)[0], sf, 0.7), 96)


def at(fid, t):   # a moment of a Freesound recording, s
    return int(t * SR)


def fs(fid):
    return load(os.path.join(FS, f'{fid}.mp3'), 1)


# into a body: the smacks of "VisceralBulletImpacts" (u1769092, 423301) without the whizz before them; into the head: "Headshot sound" (MadPanCake, 660769)
x = fs(423301)
for k, t in enumerate([0.151, 0.512, 1.569, 1.896]):
    save(f'hit-body-{k + 1}', cut(x, at(423301, t), 0.28, 0.6), 96)
save('hit-head', cut(fs(660769), 0, 0.42, 0.5), 96)

# into a wall or the ground near you: "Bullet Hits" (161001; bullets hitting next to the microphone), a ricochet (morganpurkis, 392975),
# a hit into the ground (modusmogulus, 789388); and the crack of a bullet flying past you, from the same "Bullet Hits"
x = fs(161001)
for k, (t, s) in enumerate([(1.4, 0.6), (4.54, 0.5), (5.89, 0.42)]):
    save(f'hit-wall-{k + 1}', cut(x, at(161001, t), s, 0.6), 96)
save('ricochet', cut(fs(392975), 0, 0.75, 0.5), 96)
save('hit-ground', cut(fs(789388), at(789388, 0.15), 0.62, 0.6), 96)
save('crack-1', cut(x, at(161001, 3.395), 0.28, 0.7), 96)
save('crack-2', cut(x, at(161001, 0.045), 0.14, 0.6), 96)
