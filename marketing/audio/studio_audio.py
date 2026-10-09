"""studio_audio — a small, dependable music + SFX engine for marketing videos.

Everything is synthesised (no samples, no licensing). Stereo stems are mixed with a reverb send,
kick sidechain, soft clipping and a -1.5 dBFS peak, which is what makes the result sound produced
rather than "beeps on a timeline".

    from studio_audio import *
    s = Song(dur=30, bpm=100, seed=7)
    s.add('kick', kick(), 2.4); s.sidechain(2.4)
    s.render('audio.wav')

Rules (see MARKETING-STUDIO.md §8): one new genre per video; UI sounds tuned to the key, quiet, on the grid.
"""
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR = 48000
_rng = np.random.default_rng(2026)


# ───────────────────────── basics
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)          # MIDI note → Hz (60 = middle C)
def tt(d): return np.arange(max(1, int(d * SR))) / SR
def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def bp(x, a, b, o=2): return sosfilt(butter(o, [a, b], 'band', fs=SR, output='sos'), x)
def saw(f, t, ph=0.0): return 2 * ((f * t + ph) % 1) - 1
def noise(n): return _rng.standard_normal(n)
def env(t, a=0.005, d=None, rel=0.05):
    e = np.minimum(1, t / max(a, 1e-4))
    if d is not None: e = e * np.clip((d - t) / rel, 0, 1)
    return e


# ───────────────────────── drums
def kick(punch=140, body=48, dec=7):
    t = tt(0.4); f = body + punch * np.exp(-t * 35)
    return np.tanh(2.2 * np.sin(2 * np.pi * np.cumsum(f) / SR)) * np.exp(-t * dec) + hp(noise(len(t)), 3500) * np.exp(-t * 400) * .35
def kick808(m=26, d=0.55):
    t = tt(d); f = hz(m) + 90 * np.exp(-t * 30)
    return np.tanh(1.8 * np.sin(2 * np.pi * np.cumsum(f) / SR)) * np.exp(-t * 3.5)
def clap():
    t = tt(0.3); s = np.zeros(len(t))
    for o in (0, .008, .017, .026):
        i = int(o * SR); s[i:] += noise(len(t) - i) * np.exp(-np.arange(len(t) - i) / SR * (95 if o < .02 else 18))
    return bp(s, 900, 7000) + np.sin(2 * np.pi * 185 * t) * np.exp(-t * 28) * .5
def snare_brush():
    t = tt(0.15); return bp(noise(len(t)), 1200, 6000) * np.exp(-t * 30)
def brush_sweep(d=0.25):
    t = tt(d); return bp(noise(len(t)), 1500, 7000) * np.sin(np.pi * t / d) ** 2 * .6
def hat(open_=False):
    t = tt(0.25 if open_ else 0.05); return hp(noise(len(t)), 8500) * np.exp(-t * (14 if open_ else 85))
def ride(g=1.0):
    t = tt(0.4); return (hp(noise(len(t)), 6000) * np.exp(-t * 9) + np.sin(2 * np.pi * 5200 * t) * np.exp(-t * 12) * .1) * g
def snap():
    t = tt(0.06); return bp(noise(len(t)), 2500, 8000) * np.exp(-t * 80)
def shaker():
    t = tt(0.09); return bp(noise(len(t)), 4000, 10000) * np.sin(np.pi * t / 0.09) ** 2
def conga(m=62):
    t = tt(0.3); f = hz(m) * (1 + .3 * np.exp(-t * 40)); return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 14)
def dhol(low=True):
    t = tt(0.5); f = (70 if low else 220) * (1 + .5 * np.exp(-t * 30))
    return np.tanh(1.5 * np.sin(2 * np.pi * np.cumsum(f) / SR)) * np.exp(-t * (6 if low else 16))


# ───────────────────────── tonal
def supersaw(notes, d, cut=3200, voices=5):
    """Wide detuned chord → (left, right)."""
    t = tt(d + 0.15); l = np.zeros(len(t)); r = np.zeros(len(t))
    for m in notes:
        for v in range(voices):
            s = saw(hz(m + (v - (voices - 1) / 2) * 0.09), t, _rng.random()); pan = v / (voices - 1) * 2 - 1
            l += s * (1 - pan) / 2; r += s * (1 + pan) / 2
    e = env(t, .01, d + .15, .15); k = len(notes) * voices / 2
    return lp(l * e, cut) / k, lp(r * e, cut) / k
def pad(notes, d, cut=1800):
    l, r = supersaw(notes, d, cut, 3); t = tt(len(l) / SR); a = np.minimum(1, t / 0.4)
    return l * a, r * a
def pluck(m, d=0.35, bright=4500):
    t = tt(d); f = hz(m)
    return lp(saw(f, t) + .5 * saw(f * 2.002, t, .3) + .3 * np.sin(2 * np.pi * f * t), bright) * np.exp(-t * 11) * env(t, .002)
def keys(notes, d=0.4):
    t = tt(d); s = sum(np.sin(2 * np.pi * hz(m) * t) + .4 * np.sin(4 * np.pi * hz(m) * t) * np.exp(-t * 6) for m in notes)
    return s / len(notes) * np.exp(-t * 5) * env(t, .003)
def bass(m, d):
    t = tt(d); f = hz(m)
    return lp(np.sin(2 * np.pi * f * t) + .35 * np.tanh(3 * np.sin(2 * np.pi * f * t)) + .15 * saw(f, t), 900) * env(t, .004, d, .02)
def upright(m, d=0.48):
    t = tt(d); f = hz(m)
    s = np.sin(2 * np.pi * f * t) + .5 * np.sin(4 * np.pi * f * t) * np.exp(-t * 8) + .2 * np.sin(6 * np.pi * f * t) * np.exp(-t * 14)
    return (s * np.exp(-t * 4.5) + bp(noise(len(t)), 80, 400) * np.exp(-t * 60) * .4) * env(t, .004)
def marimba(m, d=0.5):
    t = tt(d); f = hz(m); return (np.sin(2 * np.pi * f * t) + .3 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * 30)) * np.exp(-t * 7) * env(t, .002)
def vibes(m, d=0.9):
    t = tt(d); f = hz(m)
    return (np.sin(2 * np.pi * f * t) + .2 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * 20)) * np.exp(-t * 3) * (1 + .25 * np.sin(2 * np.pi * 5.5 * t)) * env(t, .002)
def chop(m, d=0.24, vowel='ah'):
    """Vocal-chop: saw through three formant band-passes."""
    t = tt(d); f = hz(m) * (1 + .006 * np.sin(2 * np.pi * 6 * t)); s = saw(f, t) + .5 * saw(f * 2.003, t)
    F = {'ah': [(700, 1100), (1100, 1450), (2500, 2900)], 'oh': [(400, 650), (750, 1000), (2300, 2700)], 'ee': [(260, 420), (1900, 2400), (2800, 3300)]}[vowel]
    return sum(bp(s, a, b) * g for (a, b), g in zip(F, (1, .7, .35))) * env(t, .012, d, .06)
def brass(notes, d=0.3):
    t = tt(d); s = sum(saw(hz(m), t) for m in notes) / len(notes)
    return lp(s, 600 + 2500 * np.exp(-t * 8)) * env(t, .01, d, .05)


# ───────────────────────── transitions + UI sounds (tune `m` to the song key)
def riser(d):
    t = tt(d); k = (t / d) ** 2; x = noise(len(t)); return (lp(x, 1000) * (1 - k) + bp(x, 2000, 11000) * k) * k
def impact():
    t = tt(1.5)
    return np.tanh(2 * np.sin(2 * np.pi * np.cumsum(40 + 50 * np.exp(-t * 9)) / SR)) * np.exp(-t * 2.5) + lp(noise(len(t)), 3000) * np.exp(-t * 4) * .4
def whoosh(d=0.5):
    t = tt(d); x = noise(len(t)); k = t / d; return (lp(x, 800) * (1 - k) + bp(x, 1500, 9000) * k) * np.sin(np.pi * k) ** 2
def ding(m=88):
    t = tt(0.9); f = hz(m); return (np.sin(2 * np.pi * f * t) * np.exp(-t * 6) + .5 * np.sin(2 * np.pi * f * 1.5 * t) * np.exp(-t * 9)) * env(t, .003)
def tick(m=88):
    t = tt(0.06); return np.sin(2 * np.pi * hz(m) * t) * np.exp(-t * 90) + bp(noise(len(t)), 3000, 8000) * np.exp(-t * 300) * .3
def pop(m=84):
    t = tt(0.12); f = hz(m) * (1 + 1.5 * np.exp(-t * 60)); return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 35)
def chime(m=84):
    t = tt(1.4); f = hz(m); return np.sin(2 * np.pi * f * t + np.exp(-t * 6) * np.sin(4 * np.pi * f * t)) * np.exp(-t * 3)
def kaching():
    return np.concatenate([ding(96)[: int(.08 * SR)], ding(100)]) * .8


# ───────────────────────── song + mix
STEMS = ('kick', 'drums', 'bass', 'chords', 'lead', 'vox', 'fx')
class Song:
    def __init__(self, dur, bpm=100, seed=1):
        self.N = int(dur * SR); self.beat = 60 / bpm; self.bar = 4 * self.beat
        self.L = {k: np.zeros(self.N) for k in STEMS}; self.R = {k: np.zeros(self.N) for k in STEMS}
        self.duck = np.ones(self.N); self.auto = np.ones(self.N)
        global _rng; _rng = np.random.default_rng(seed)

    def add(self, stem, sig, t0, g=1.0, pan=0.0):
        """Mono signal at time t0 (s), constant-power pan -1..1."""
        i = int(round(t0 * SR))
        if i < 0 or i >= self.N: return
        s = sig[: self.N - i] * g
        self.L[stem][i:i + len(s)] += s * np.sqrt((1 - pan) / 2) * 1.414
        self.R[stem][i:i + len(s)] += s * np.sqrt((1 + pan) / 2) * 1.414

    def add_st(self, stem, lr, t0, g=1.0):
        l, r = lr; i = int(round(t0 * SR))
        if i >= self.N: return
        n = min(len(l), self.N - i); self.L[stem][i:i + n] += l[:n] * g; self.R[stem][i:i + n] += r[:n] * g

    def sidechain(self, t, depth=.55, rel=11):
        i = int(t * SR); n = int(.28 * SR)
        if i >= self.N: return
        e = 1 - depth * np.exp(-np.arange(n) / SR * rel); self.duck[i:i + n] = np.minimum(self.duck[i:i + n], e[: self.N - i])

    def level(self, t0, t1, g, ramp=.05):
        a, b = int(t0 * SR), min(self.N, int(t1 * SR)); r = int(ramp * SR); self.auto[a:b] = g
        if a > r: self.auto[a - r:a] = np.linspace(self.auto[a - r - 1], g, r)

    def _room(self, x, seed, length=2.0, dec=2.6):
        k = int(length * SR); ir = lp(hp(np.random.default_rng(seed).standard_normal(k) * np.exp(-np.arange(k) / SR * dec), 300), 8000)
        return fftconvolve(x, ir)[: self.N] / np.sqrt(np.sum(ir ** 2))

    def render(self, path, fade=1.8, peak_db=-1.5, verb=.18, drive=1.7):
        out = []
        for side, D, seed in (('L', self.L, 1), ('R', self.R, 2)):
            du, A = self.duck, self.auto
            dry = (D['kick'] * .9 + D['drums'] * .55 + lp(D['bass'], 260) * .7 + D['chords'] * du * .45 + D['lead'] * du * .6 + D['vox'] * .6) * A + D['fx'] * .75
            send = (D['chords'] * du * .25 + D['lead'] * .35 + D['vox'] * .45 + D['drums'] * .05) * A + D['fx'] * .3
            out.append(dry + self._room(send, seed) * verb)
        st = hp(np.stack(out), 30); st = st + hp(st, 5000) * .25                   # low cut + air
        if fade: k = int(fade * SR); st[:, -k:] *= np.cos(np.linspace(0, np.pi / 2, k)) ** 2
        st /= np.max(np.abs(st)) + 1e-9; st = np.tanh(st * drive) / np.tanh(drive); st *= 10 ** (peak_db / 20)
        wavfile.write(path, SR, (st.T * 32767).astype(np.int16))
        m = st.mean(0); rms = 20 * np.log10(np.sqrt(np.mean(m ** 2)) + 1e-9)
        print(f'{path}: rms {rms:.1f} dB, peak {peak_db} dBFS'); return rms
