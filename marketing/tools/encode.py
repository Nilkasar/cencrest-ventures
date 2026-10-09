"""encode.py — frames + wav → Instagram/Play-safe mp4 (bt709, yuv420p, faststart) with a baked-in cover.
    python tools/encode.py out/frames audio.wav out/reel.mp4 --cover 4.5 [--fps 30]
--cover <seconds>: copies that (settled, strongest) frame over frame 0 and saves <name>-cover.jpg next to the mp4,
so every platform's thumbnail shows it without changing duration or sync.
"""
import argparse, json, os, shutil, subprocess

cfg = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'studio.config.json')))
a = argparse.ArgumentParser(); a.add_argument('frames'); a.add_argument('wav'); a.add_argument('out')
a.add_argument('--cover', type=float); a.add_argument('--fps', type=int, default=30); x = a.parse_args()
if x.cover is not None:
    src = os.path.join(x.frames, f'{round(x.cover * x.fps):05d}.jpg')
    shutil.copyfile(src, os.path.splitext(x.out)[0] + '-cover.jpg'); shutil.copyfile(src, os.path.join(x.frames, '00000.jpg'))
os.makedirs(os.path.dirname(os.path.abspath(x.out)), exist_ok=True)
subprocess.run([cfg['ffmpeg'], '-y', '-loglevel', 'error', '-framerate', str(x.fps), '-i', os.path.join(x.frames, '%05d.jpg'), '-i', x.wav,
    '-vf', 'format=rgb24,scale=out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', x.out], check=True)
r = subprocess.run([cfg['ffmpeg'], '-hide_banner', '-i', x.out, '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True).stderr
print(x.out, [l.split('] ')[-1] for l in r.splitlines() if 'Duration' in l or 'max_volume' in l or 'mean_volume' in l])
