#!/usr/bin/env python3
"""Copy the Dubtrain samples for the sound events XRogue raises (be_sound()
calls in the sources) into <out> and write <out>/sounds.json {event: [files]}."""
import json, os, shutil, sys
PACK = os.path.expanduser('~/Downloads/Dubtrain Angband Sound Pack v3.1.0')
EVENTS = ['hit', 'miss', 'mon_hit', 'kill', 'money1', 'drop', 'eat', 'quaff', 'hungry', 'level',
          'teleport', 'store5', 'wield', 'death', 'stairs_up', 'stairs_down']
out = sys.argv[1]
cfg = {}
for line in open(os.path.join(PACK, 'sound.cfg'), encoding='latin-1'):
    if '=' in line and not line.lstrip().startswith('#'):
        k, v = line.split('=', 1)
        cfg[k.strip()] = v.split()
os.makedirs(out, exist_ok=True)
used = {e: cfg.get(e, []) for e in EVENTS}
for files in used.values():
    for f in files:
        shutil.copy(os.path.join(PACK, f), out)
json.dump(used, open(os.path.join(out, 'sounds.json'), 'w'))
