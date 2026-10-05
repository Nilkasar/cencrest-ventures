"""Example score: feel-good future-pop, 100 BPM, Bb major, built for templates/reel.html.

Reel grid (100 BPM → beat 0.6 s, bar 2.4 s):  hook 0–2.4 · ch1 2.4–8.4 · ch2 8.4–14.4 · ch3 14.4–20.4 · outro 20.4–24
Copy this file per video and CHANGE THE GENRE (see GENRES.md). Keep UI sound times identical to the video's events.
    python example_futurepop.py out.wav
"""
import sys
from studio_audio import *

DUR, BPM = 24.0, 100
s = Song(DUR, BPM, seed=11); B, BAR = s.beat, s.bar
PROG = [(46, [58, 62, 65, 70]), (41, [57, 60, 65, 69]), (43, [58, 62, 67, 70]), (39, [58, 63, 67, 70])]   # I V vi IV
HOOK = [(0, 77, .5, 'ah'), (.5, 77, .5, 'oh'), (1, 74, .5, 'ah'), (1.5, 72, 1, 'ee'), (2.5, 74, .5, 'ah'), (3, 77, .5, 'oh'), (3.5, 79, .5, 'ah')]
ARP = [0, 4, 7, 12, 7, 4, 7, 9]

for bi, tb in enumerate(np.arange(0, 20.4 - 1e-6, BAR)):
    root, ch = PROG[bi % 4]; intro = tb < 2.4
    s.add_st('chords', supersaw(ch, BAR, 1800 if intro else 3600), tb, .5)
    if intro:
        for k in range(4): s.add('lead', pluck(ch[k] + 12, .4, 2500), tb + k * B, .18, pan=(k % 2) * .6 - .3)
        continue
    for k in range(4):
        t = tb + k * B; s.add('kick', kick(), t, .95); s.sidechain(t)
        if k in (1, 3): s.add('drums', clap(), t, .38)
        s.add('drums', hat(), t + B / 2, .12, pan=.35)
        s.add('drums', hat(), t + B / 4, .05, pan=-.35); s.add('drums', hat(), t + 3 * B / 4, .05, pan=-.35)
    for off, m, d in ((0, root, .5), (.75 * B, root + 12, .2), (B, root, .3), (1.5 * B, root + 12, .2), (2 * B, root, .5), (2.75 * B, root + 7, .25), (3.25 * B, root + 12, .25)):
        s.add('bass', bass(m, d), tb + off, .75)
    if int((tb - 2.4) // 6) == 1:
        for j in range(16): s.add('lead', pluck(ch[0] + 12 + ARP[j % 8], .25), tb + j * B / 4, .13, pan=((j % 4) - 1.5) / 3)
    else:
        for o, m, d, v in HOOK: s.add('vox', chop(m + (2 if bi % 2 else 0), d * B * .95, v), tb + o * B, .3, pan=.15 if bi % 2 else -.15)

# outro
s.add_st('chords', supersaw([58, 62, 65, 70, 74], 3.6, 2800), 20.4, .5); s.add('bass', bass(34, 2.4), 20.4, .7); s.add('kick', kick(), 20.4, .9)
for k, (o, m) in enumerate(((0, 77), (.3, 74), (.6, 70), (.9, 74), (1.2, 77))): s.add('vox', chop(m, .35), 20.4 + o, .22 * (1 - k * .12))

# transitions + UI sounds — SAME times as templates/reel.html events
for t in (8.4, 14.4, 20.4): s.add('fx', riser(1.2), t - 1.2, .22); s.add('fx', impact(), t, .32)
s.add('fx', riser(1.6), .8, .25); s.add('fx', impact(), 2.4, .4)
for t in (2.4, 8.4, 14.4, 20.4): s.add('fx', whoosh(.5), t - .25, .12)
for t in (4.2, 10.2, 16.2): s.add('fx', tick(89), t, .16)        # finger tap on each chapter
for t in (6.0, 12.0, 18.0): s.add('fx', ding(91), t, .16)        # "done" toast on each chapter
for k, m in enumerate((81, 85, 88)): s.add('fx', chime(m), 21.6 + k * .05, .07)
s.render(sys.argv[1] if len(sys.argv) > 1 else 'audio.wav')
