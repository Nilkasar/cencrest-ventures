"""beatcheck.py — prove the cuts land on the music.
    python tools/beatcheck.py out/reel.mp4 2.4,8.4,14.4,20.4 [--tol 1]
Decodes the video small and grey, finds visual cuts (spikes in frame difference) and reports, for every
planned hit time, the nearest cut and its offset in frames. Exit code 1 if any hit is off by more than --tol frames.
"""
import argparse, json, os, subprocess, sys
import numpy as np

cfg = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'studio.config.json')))
a = argparse.ArgumentParser(); a.add_argument('mp4'); a.add_argument('hits'); a.add_argument('--tol', type=int, default=1)
a.add_argument('--fps', type=int, default=30); x = a.parse_args()
W, H = 96, 170
raw = subprocess.run([cfg['ffmpeg'], '-loglevel', 'error', '-i', x.mp4, '-vf', f'scale={W}:{H},format=gray', '-f', 'rawvideo', '-'], capture_output=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(np.float32)
d = np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2))                 # d[i] = change from frame i to i+1
thr = np.median(d) + 4 * (np.median(np.abs(d - np.median(d))) + 1e-3)
cuts = [i + 1 for i in range(1, len(d) - 1) if d[i] > thr and d[i] >= d[i - 1] and d[i] >= d[i + 1]]
bad = 0
for h in [float(v) for v in x.hits.split(',')]:
    f = round(h * x.fps); near = min(cuts, key=lambda c: abs(c - f)) if cuts else None
    off = None if near is None else near - f; ok = off is not None and abs(off) <= x.tol; bad += not ok
    print(f'hit {h:6.2f}s  frame {f:4d}  nearest cut {near}  offset {off:+} frames  {"OK" if ok else "CHECK"}' if near is not None else f'hit {h}s: no cut found')
print(f'{len(cuts)} cuts detected; {bad} hit(s) need a look'); sys.exit(1 if bad else 0)
