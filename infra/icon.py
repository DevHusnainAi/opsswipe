# Draws every app icon from one geometry. Run from app/: python3 ../infra/icon.py
# One drawing for every icon size: two cards, the back one clearly visible, the group centred.
from PIL import Image, ImageDraw
SS = 4  # supersampling
BG, BACK, EDGE, FRONT, GREEN = (10,10,10,255), (39,39,42,255), (16,185,129,255), (237,237,237,255), (16,185,129,255)

def card(size, fill, outline=None, width=0, angle=0, dot=False):
    w, h = size
    im = Image.new('RGBA', (w + 8*SS, h + 8*SS), (0,0,0,0))
    d = ImageDraw.Draw(im)
    r = int(w * 0.16)
    d.rounded_rectangle([4*SS, 4*SS, 4*SS + w, 4*SS + h], radius=r, fill=fill, outline=outline, width=width)
    if dot:
        s = int(w * 0.17); x = 4*SS + int(w * 0.14); y = 4*SS + int(w * 0.14)
        d.ellipse([x, y, x + s, y + s], fill=GREEN)
    return im.rotate(angle, resample=Image.BICUBIC, expand=True)

def mark(px, mono=False):
    """The two cards on a transparent px*px canvas, filling ~100% of it."""
    S = px * SS
    im = Image.new('RGBA', (S, S), (0,0,0,0))
    w, h = int(S * 0.50), int(S * 0.66)
    back = card((w, h), (255,255,255,255) if mono else BACK, None if mono else EDGE, 0 if mono else int(S*0.018), 10)
    front = card((w, h), (255,255,255,255) if mono else FRONT, angle=-12, dot=not mono)
    im.alpha_composite(back, (int(S*0.30) - back.width//2, S//2 - back.height//2 - int(S*0.01)))
    im.alpha_composite(front, (int(S*0.60) - front.width//2, S//2 - front.height//2 + int(S*0.02)))
    bbox = im.getchannel('A').getbbox()
    im = im.crop(bbox)
    side = max(im.size); sq = Image.new('RGBA', (side, side), (0,0,0,0))
    sq.alpha_composite(im, ((side - im.width)//2, (side - im.height)//2))
    return sq

def place(canvas_px, fill_ratio, bg=None, mono=False):
    S = canvas_px * SS
    out = Image.new('RGBA', (S, S), bg or (0,0,0,0))
    m = mark(canvas_px, mono).resize((int(S*fill_ratio),)*2, Image.LANCZOS)
    out.alpha_composite(m, ((S - m.width)//2, (S - m.height)//2))
    return out.resize((canvas_px, canvas_px), Image.LANCZOS)

place(1024, 0.62, BG).save('assets/icon.png')                          # iOS / store: no mask safe zone issues
place(512, 0.58, None).save('assets/android-icon-foreground.png')       # adaptive: inside the 66dp safe zone
place(432, 0.58, None, mono=True).save('assets/android-icon-monochrome.png')
place(560, 0.96, None).save('assets/logo-mark.png')                     # in-app mark, tight
place(48, 0.80, BG).save('assets/favicon.png')
print('ok')
