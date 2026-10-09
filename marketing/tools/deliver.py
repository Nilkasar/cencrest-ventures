"""deliver.py — copy renders into the deliverables folder, retrying when a viewer/sync app locks files.
    python tools/deliver.py out/posters deliverables/posters-v01-launch
"""
import os, shutil, sys, time

src, dst = sys.argv[1], sys.argv[2]; n = 0
for root, _, files in os.walk(src):
    for f in files:
        if f.startswith('_'): continue
        s = os.path.join(root, f); d = os.path.join(dst, os.path.relpath(s, src)); os.makedirs(os.path.dirname(d), exist_ok=True)
        for i in range(10):
            try: shutil.copyfile(s, d); n += 1; break
            except OSError: time.sleep(1)
        else: print('LOCKED, not copied:', d)
print(n, 'files ->', dst)
