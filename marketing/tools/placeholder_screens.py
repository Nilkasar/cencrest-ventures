"""placeholder_screens.py — make stand-in 780×1688 'app screens' + logo so the templates render on day one.
REPLACE THESE WITH REAL SCREENS (MARKETING-STUDIO.md §3) BEFORE MAKING ANYTHING PUBLIC.
    python tools/placeholder_screens.py shots
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1] if len(sys.argv) > 1 else 'shots'; os.makedirs(out, exist_ok=True)
def font(sz):
    for f in ('arialbd.ttf', 'Arial Bold.ttf', 'DejaVuSans-Bold.ttf'):
        try: return ImageFont.truetype(f, sz)
        except OSError: pass
    return ImageFont.load_default()
for name, col, big in (('home', '#FF6FA5', '42,680'), ('feature1', '#2BC4B0', '8,420'), ('feature2', '#8B5CF6', '1,189'), ('feature3', '#F97316', '18,711')):
    im = Image.new('RGB', (780, 1688), '#FBF8F4'); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 780, 120], fill='#ffffff'); d.text((40, 38), 'Your App', fill='#16131f', font=font(44))
    d.text((40, 160), name.upper(), fill='#6b7280', font=font(30))
    d.rounded_rectangle([30, 220, 750, 520], 40, fill=col); d.text((70, 300), big, fill='white', font=font(110))
    for i in range(7):
        y = 580 + i * 150; d.rounded_rectangle([30, y, 750, y + 126], 30, fill='white')
        d.rounded_rectangle([56, y + 24, 136, y + 104], 22, fill='#F1F5F9'); d.text((170, y + 30), f'Row item {i + 1}', fill='#16131f', font=font(34))
        d.text((170, y + 76), 'detail · source', fill='#8B5CF6', font=font(22)); d.text((560, y + 40), f'-{(i + 2) * 137}', fill='#E11D48', font=font(36))
    d.text((40, 1640), 'PLACEHOLDER — replace with a real screen', fill='#E11D48', font=font(22))
    im.save(os.path.join(out, f'{name}_screen.png'))
open(os.path.join(out, 'logo.svg'), 'w').write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
    '<stop offset="0" stop-color="#B98BFF"/><stop offset=".55" stop-color="#FF6FA5"/><stop offset="1" stop-color="#FF8A7A"/></linearGradient></defs>'
    '<rect width="100" height="100" rx="24" fill="url(#g)"/><text x="50" y="68" font-family="Arial" font-weight="900" font-size="56" text-anchor="middle" fill="#fff">A</text></svg>')
print('placeholder screens ->', out)
