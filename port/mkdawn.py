#!/usr/bin/env python3
"""Second tile set: DawnLike (DragonDePlatino, palette DawnBringer, CC BY 4.0),
sprites picked by name from rvip-tools/tilesets/dawnlike_names.tsv
(names: Tommy Ettinger's DawnLikeAtlas).

Writes tiles-dawn.png/.rgba with the same slot layout as tiles.png (mktiles.py,
which it runs). Every slot the game uses gets a DawnLike sprite, nothing is left
NetHack: tile sets are never mixed. Per slot: the game's own name, else the
NetHack name mktiles.py chose (DawnLike follows NetHack's names), else DAWN."""
import glob, itertools, os, re, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.expanduser('~/Games/rvip-tools/tilesets'))
from dawnlike_preview import pos, sprite
sys.path.insert(0, HERE)
import mktiles as M

DAWN = {  # NetHack or game name -> DawnLike name, where DawnLike has neither
 # NetHack stand-ins that DawnLike names differently
 'raven': 'bald eagle', 'dog': 'hound', 'rothe': 'black boar', 'horse': 'brown horse',
 'neanderthal': 'caveman', 'giant eel': 'eel', 'doppelganger': 'giant mimic',
 'aleax': 'archon', 'human': 'fighter', 'cleric': 'priest', 'rogue': 'thief',
 'displacer beast': 'panther', 'couatl': 'serpent', 'ki-rin': 'kirin', 'axe beak': 'terror bird', 'djinni': 'djinn', 'beholder': 'eye tyrant',
 'amorous demon': 'succubus', 'baby red dragon': 'baby firedrake', 'jaguar': 'panther',
 'kobold leader': 'kobold lord', 'ogre tyrant': 'ogre king', 'orc-captain': 'orc king',
 'red dragon': 'firedrake', 'green dragon': 'glendrake', 'yellow dragon': 'sanddrake',
 'white dragon': 'icewyrm', 'black dragon': 'darkwyrm', 'blue dragon': 'storrmwyrm',
 'silver dragon': 'sheenwyrm', 'gold dragon': 'kingwyrm', 'shimmering dragon': 'lightwyrm',
 'orange dragon': 'searwyrm', 'gray dragon': 'dreadwyrm', 'chromatic dragon': 'dreadwyrm',
 # game names whose NetHack stand-in is an item or missing
 'black bear': 'owlbear', 'brown bear': 'owlbear', 'bat': 'giant bat', 'cold elemental': 'frost giant',
 'silver cloud': 'fog cloud', 'blue pool horror': 'blue jelly', 'diamond golem': 'crystal golem',
 'ancient chrome dragon': 'sheenwyrm', 'ancient crystal dragon': 'lightwyrm',
 'ancient night dragon': 'darkwyrm', 'ancient electrum dragon': 'kingwyrm',
 # weapons, armour, relics
 'bow': 'shortbow', 'tomahawk': 'axe', 'burning oil': 'murky potion', 'pick-axe': 'pick axe',
 'glaive': 'long poleaxe', 'pertuska': 'short sword', 'claymore': 'two handed sword',
 'leather armor': 'bronze armor', 'ring mail': 'hotrock mail', 'studded leather armor': 'lacquered armor',
 'scale mail': 'scale armor', 'leather jacket': 'bronze armor', 'chain mail': 'grandmaster mail',
 'splint mail': 'iron armor', 'plate mail': 'full plate', 'crystal plate mail': 'mirror plate',
 'elven mithril-coat': 'shockfrost mail', 'crystalline armor': 'mirror plate', 'armor': 'iron armor',
 'soft leather': 'bronze armor', 'cuirboilli': 'breastplate', 'superior chain': 'banded mail',
 'crown of might': 'kingly crown', 'silmaril of ea': 'gleaming red gem', 'wand of yendor': 'jeweled wand',
 # terrain and unknown items
 'staircase down': 'small stairs down', 'trap door': 'trap door tile', 'arrow trap': 'arrow trap tile',
 'sleeping gas trap': 'sleeping gas trap tile', 'teleportation trap': 'teleportation trap tile',
 'dart trap': 'dart trap tile', 'magic portal': 'magic portal tile', 'pool': 'blue pool',
 'level teleporter': 'stone portal', 'tree': 'young fruit tree', 'horizontal closed door': 'lit brick wall left right',
 'potion': 'clear potion', 'scroll': 'blank scroll', 'weapon': 'long sword', 'tool': 'bag',
 'amulet': 'amulet of yendor', 'ring': 'gold ring', 'wand': 'oak wand', 'gold piece': 'pile of gold coins',
 # Advanced Rogue / XRogue uniques and relics
 'invisible monster': 'ghost', 'dwarf ruler': 'dwarf king', 'lord surtur': 'fire giant',
 'arch-lich': 'archlich', 'master kaen': 'master lich', 'large dog': 'hound',
 'winter wolf cub': 'baby winter wolf', 'shark': 'great white shark', 'pony': 'brown horse',
 'sasquatch': 'yeti', 'large rock': 'boulder', 'bronze plate mail': 'breastplate',
 'cloak of emori': 'forest cloak', 'cloak of magic resistance': 'forest cloak',
 'ankh of heil': 'fuzzy amulet', 'amulet of reflection': 'fuzzy amulet',
 'amulet of stonebones': 'jasper amulet', 'amulet of life saving': 'jasper amulet',
 'wand of orcus': 'jeweled wand', 'jeweled': 'jeweled wand', 'rod of asmodeus': 'bone wand',
 'spiked': 'bone wand', 'conflict': 'ruby ring', 'credit card': 'key',
}
WALL = 'lit brick wall '
FIXED = {'HWALL': WALL + 'left right', 'VWALL': WALL + 'up down', 'TL': WALL + 'right down',
         'TR': WALL + 'left down', 'BL': WALL + 'right up', 'BR': WALL + 'left up',
         'HDOOR': 'day tile floor nswe', 'VDOOR': 'day tile floor nswe',   # doors are gaps
         'FLOOR': 'day tile floor nswe', 'CORR': 'night stone floor c'}

H = open(os.path.join(HERE, 'tilemap.h')).read()
dfn = lambda n: int(re.search(r'#define %s (\d+)' % n, H)[1])
arr = lambda n: [int(v) for v in re.search(r'%s\[\d*\] = \{([^}]*)' % n, H)[1].split(',')]

CSRC = ''.join(open(f, encoding='latin-1').read() for f in sorted(glob.glob(os.path.join(M.SRC, '*.c'))))

def pick(game, slot):
    base = re.sub(r'\s*\(.*\)', '', game or '').strip()
    for c in [game, base] + [re.sub(r'^T:', '', n) for n in M.names[slot]]:
        for d in (c, c and c.lower(), c and c.lower().replace('-', ' ')):
            d = DAWN.get(d, d)
            if d in pos: return d

img = Image.new('RGBA', Image.open(os.path.join(HERE, 'tiles.png')).size, (0, 0, 0, 0))
filled, missing = {}, []
def put(slot, game=None, name=None):
    if slot < 0 or slot in filled: return
    name = name or pick(game, slot)
    if not name: missing.append('%s [%s]' % (game, M.names[slot][0])); return
    filled[slot] = name
    img.paste(sprite(name), ((slot % M.PER_ROW) * 16, (slot // M.PER_ROW) * 16))

for n, s in zip(M.mons, arr('mon_tile')): put(s, n)
for s in arr('class_tile'): put(s)
for n, s in zip(M.WEAP, arr('weap_tile')): put(s, n)
for n, s in zip(M.ARMOR, arr('armor_tile')): put(s, n)
for n, s in zip(M.RELIC, arr('relic_tile')): put(s, n)
for k, n in FIXED.items(): put(dfn('T_' + k), name=n)
for s in arr('terrain_tile') + arr('generic_tile'): put(s)

# random looks: tiles.c hashes the look (first letter lowered, as init.c stores
# it) into a slot range; each slot gets the sprite named after a look landing
# there, else the next unused sprite of that kind
def looks(name):
    m = re.search(r'\b%s\s*\[[^]]*\]\s*=\s*\{([^}]*)' % name, CSRC)
    return [l[0].lower() + l[1:] for l in re.findall(r'"([^"]*)"', re.sub(r'/\*.*?\*/', '', m[1], flags=re.S))]
def hslot(s, first, n):
    v = 5381
    for c in s.encode('latin-1'): v = (v * 33 + c) & 0xffffffff
    return first + v % n
for cls, ls, suffix in (('POTION', looks('rainbow'), ' potion'), ('RING', looks('stones'), ' ring'),
                        ('WAND', looks('wood') + looks('metal'), ' wand'), ('SCROLL', [], ' scroll')):
    first, n = dfn(cls + '_TILES'), dfn(cls + '_NTILES')
    for l in ls:
        if l.lower() + suffix in pos: put(hslot(l, first, n), name=l.lower() + suffix)
    kind = sorted(k for k in pos if k.endswith(suffix))   # repeats once all are used
    spare = itertools.cycle(sorted(kind, key=lambda k: k in filled.values()))
    for s in range(first, first + n): put(s, name=next(spare))

if missing: sys.exit('no DawnLike sprite:\n' + '\n'.join(missing))
img.save(os.path.join(HERE, 'tiles-dawn.png'))
open(os.path.join(HERE, 'tiles-dawn.rgba'), 'wb').write(
    img.size[0].to_bytes(4, 'little') + img.size[1].to_bytes(4, 'little') + img.tobytes())
print(len(filled), 'slots, all DawnLike')
