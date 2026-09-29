#!/usr/bin/env python3
"""Synthesizes the XRogue web sound effects (the game has none of its own and
no sound pack was released for it) into <out>/*.wav plus <out>/sounds.json
{event: [files]}: short, quiet, made here, no third-party samples.
Events are the be_sound() names the game raises.
    python3 web/mksounds.py web/dist/sound"""
import json, math, os, random, struct, sys, wave

# XRogue's palette: waveform, pitch (x 220 Hz), tempo (x duration), noise seed
KIND, PITCH, TEMPO, SEED = 'sine', 0.95, 1.0, 803
EVENTS = ['hit', 'miss', 'mon_hit', 'kill', 'money1', 'drop', 'eat', 'quaff', 'hungry', 'level', 'teleport', 'store5', 'wield', 'death', 'stairs_up', 'stairs_down', 'shoot_hit', 'shoot_miss']
RATE = 22050
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
rnd = random.Random(SEED)
WAVES = {'sine': math.sin,
         'square': lambda p: 0.5 if math.sin(p) > 0 else -0.5,
         'tri': lambda p: 2 / math.pi * math.asin(math.sin(p)),
         'saw': lambda p: ((p / math.pi) % 2 - 1) * 0.6}


def tone(freqs, dur, vol=0.35, noise=0.0, kind=None):
    """freqs: list of steps (x 220 Hz x PITCH) or a function of t in 0..1"""
    wav, n, ph = WAVES[kind or KIND], int(RATE * dur * TEMPO), 0.0
    s = []
    for i in range(n):
        t = i / n
        f = freqs(t) if callable(freqs) else freqs[min(len(freqs) - 1, int(t * len(freqs)))]
        ph += 2 * math.pi * f * 220 * PITCH / RATE
        v = wav(ph) * (1 - noise) + (rnd.random() * 2 - 1) * noise
        s.append(v * min(1.0, t / 0.02) * (1 - t) ** 1.5 * vol)
    return s


RECIPES = {
    'hit': lambda: tone(lambda t: 1 - 0.6 * t, 0.12, noise=0.6),
    'miss': lambda: tone(lambda t: 2 + t, 0.15, vol=0.15, noise=0.9),
    'mon_hit': lambda: tone(lambda t: 0.6 - 0.35 * t, 0.16, noise=0.4),
    'kill': lambda: tone([1.5, 1.2, 0.9, 0.6], 0.35, vol=0.3),
    'money1': lambda: tone([4, 5.33], 0.16, vol=0.25, kind='sine'),
    'drop': lambda: tone(lambda t: 0.5 - 0.25 * t, 0.1, noise=0.3),
    'eat': lambda: tone(lambda t: 1.2 if (t * 6) % 1 < 0.5 else 0.8, 0.36, vol=0.2, noise=0.7),
    'quaff': lambda: tone(lambda t: 1.5 + 2 * ((t * 5) % 1), 0.4, vol=0.25, kind='sine'),
    'hungry': lambda: tone(lambda t: 0.45 + 0.05 * math.sin(t * 40) - 0.15 * t, 0.5, vol=0.3),
    'level': lambda: tone([2, 2.52, 3, 4], 0.5, vol=0.3),
    'teleport': lambda: tone(lambda t: 1 + 5 * math.sin(math.pi * t), 0.4, vol=0.25),
    'store5': lambda: tone([3, 4], 0.25, vol=0.25, kind='sine'),
    'wield': lambda: tone(lambda t: 6 - t, 0.2, vol=0.2, noise=0.3),
    'death': lambda: tone(lambda t: 1.5 * (1 - 0.7 * t), 1.1, vol=0.3),
    'stairs_up': lambda: tone([1, 1.26, 1.5], 0.35, vol=0.3),
    'stairs_down': lambda: tone([1.5, 1.26, 1], 0.35, vol=0.3),
    'shoot_hit': lambda: tone(lambda t: 1.4 - 0.8 * t, 0.1, noise=0.5),
    'shoot_miss': lambda: tone(lambda t: 3 - t, 0.18, vol=0.15, noise=0.8),
}

for e in EVENTS:
    with wave.open(os.path.join(out, e + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, v)) * 32000)) for v in RECIPES[e]()))
json.dump({e: [e + '.wav'] for e in EVENTS}, open(os.path.join(out, 'sounds.json'), 'w'))
