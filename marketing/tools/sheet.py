"""sheet.py — contact sheet so you can SEE a whole set at once (always do this before reporting).
    python tools/sheet.py sheet.jpg 5 300 out/posters/*.png
"""
import glob, sys
from PIL import Image, ImageDraw

out, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = sorted(f for p in sys.argv[4:] for f in glob.glob(p))
ims = [Image.open(f).convert('RGB') for f in files]; h = int(w * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols; sheet = Image.new('RGB', (w * cols, h * rows), 'white')
for i, (f, im) in enumerate(zip(files, ims)):
    im = im.resize((w, h)); ImageDraw.Draw(im).text((8, 8), f.replace('\\', '/').split('/')[-1], fill='yellow')
    sheet.paste(im, ((i % cols) * w, (i // cols) * h))
sheet.save(out, quality=85); print(out, len(files), 'images')
