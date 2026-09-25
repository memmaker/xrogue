#!/usr/bin/env python3
"""NetHack tiles -> tiles.png (16x16, 32 per row, background transparent)
and tilemap.h (XRogue monster/item/terrain -> tile index).
RVIP step 4: Rogue variants fall back to the NetHack tileset."""
import re, sys, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
NH = os.path.join(HERE, 'nethack')
SRC = os.path.dirname(HERE)
PER_ROW = 32

names, tiles = [], []          # names[i] = list of names for tile i
for f in ('monsters', 'objects', 'other'):
    txt = open(os.path.join(NH, f + '.txt')).read().split('\n')
    pal, i = {}, 0
    while i < len(txt):
        m = re.match(r"^(\S) = \((\d+), *(\d+), *(\d+)\)", txt[i])
        if m:
            pal[m[1]] = tuple(map(int, m.group(2, 3, 4)))
        m = re.match(r"^# tile \d+ \((.*)\)$", txt[i])
        if m:
            n = m[1]
            rows = []
            i += 1
            while txt[i].strip() != "{": i += 1
            i += 1
            while not txt[i].startswith('}'):
                rows.append(txt[i].strip()); i += 1
            if f == 'monsters' and n.endswith(',female'):
                i += 1; continue
            n = re.sub(r', ?(male|nogender)$', '', n)
            key = [n] + [p.strip() for p in n.split(' / ')]
            names.append([k if f != 'other' else 'T:' + k for k in key])
            tiles.append([[pal[c] for c in r] for r in rows])
        i += 1

idx = {}
for i, ks in enumerate(names):
    for k in ks:
        idx.setdefault(k, i)

def T(n):
    if n not in idx:
        sys.exit('no NetHack tile: ' + n)
    return idx[n]

def rng(first, last):
    return T(first), T(last) - T(first) + 1

# --- monsters, in mons_def.c order -------------------------------------
MON = {
 'unknown': 'invisible monster', 'halfling': 'hobbit', 'xvart': 'goblin',
 'rot grub': 'baby long worm', 'urchin': 'acid blob',
 'fire beetle': 'giant beetle', 'ear seeker': 'centipede',
 'stirge': 'vampire bat', 'troglodyte': 'neanderthal',
 'zombie': 'human zombie', 'giant tick': 'cave spider',
 'zoo spore': 'shocking sphere', 'lonchu': 'gremlin',
 'junk monster': 'lurker above', 'jacaranda': 'green mold',
 'gnoll': 'large kobold', 'fire toad': 'salamander',
 'moon dog': 'large dog', 'violet fungi': 'violet fungus',
 'centaur': 'forest centaur', 'nymph': 'wood nymph',
 'blindheim': 'iguana', 'blink dog': 'dog', 'ghast': 'dwarf zombie',
 'shadow': 'shade', 'very young dragon': 'baby red dragon',
 'ice weasel': 'winter wolf cub', 'mimic': 'small mimic',
 'otyugh': 'quivering blob', 'su-monster': 'ape', 'leucrotta': 'leocrotta',
 'wight': 'barrow wight', 'phibian': 'crocodile',
 'fireworm': 'baby purple worm', 'flumph': 'jellyfish',
 'treant': 'wood golem', 'lava child': 'fire elemental',
 'erinyes': 'erinys', 'ulodyte': 'water demon', 'jackalwere': 'werejackal',
 'basilisk': 'pyrolisk', 'glabrezu': 'nalfeshnee',
 'wyvern': 'baby green dragon', 'specter': 'Nazgul',
 'mummy': 'human mummy', 'chimera': 'hell hound',
 'neo-otyugh': 'brown pudding', 'adult dragon': 'green dragon',
 'rhinosphynx': 'titanothere', 'lamia': 'red naga',
 'intellect devourer': 'mind flayer', 'will-o-wisp': 'yellow light',
 'invisible stalker': 'stalker', 'hellmaid': 'amorous demon',
 'shadow dragon': 'black dragon', 'xenolith': 'stone golem',
 'shambling mound': 'straw golem', 'morkoth': 'kraken',
 'white pudding': 'ochre jelly',
 'ancient black dragon': 'black dragon', 'ancient blue dragon': 'blue dragon',
 'ancient red dragon': 'red dragon', 'ancient brass dragon': 'yellow dragon',
 'ancient green dragon': 'green dragon', 'ancient white dragon': 'white dragon',
 'ancient bronze dragon': 'orange dragon',
 'ancient copper dragon': 'shimmering dragon',
 'ancient amethyst dragon': 'gray dragon',
 'ancient silver dragon': 'silver dragon',
 'ancient saphire dragon': 'blue dragon', 'ancient gold dragon': 'gold dragon',
 'nemesis': 'Minion of Huhetotl',
 'lesser god (Hruggek)': 'ogre tyrant', 'lesser god (Surtur)': 'Lord Surtur',
 'demon prince (Yeenoghu)': 'Yeenoghu', 'demon prince (Orcus)': 'Orcus',
 'arch devil (Geryon)': 'Geryon', 'arch devil (Asmodeus)': 'Asmodeus',
 'poet (Brian)': 'Norn', 'witch (Emori)': 'Neferet the Green',
 'hero (aklad)': 'King Arthur', 'cleric of thoth (Heil)': 'Arch Priest',
 'magician/thief (Nagrom)': 'Master of Thieves',
 'magician (Tsoming Zen)': 'Grand Master',
 'dwarven thief (Musty Doit)': 'dwarf ruler',
 'ruler of titans (Yendor)': 'Wizard of Yendor',
 'maker of rock (Stonebones)': 'Cyclops',
 'creator of liches (Vecna)': 'arch-lich', 'lesser god (Thrym)': 'giant',
 'lesser god (Kurtulmak)': 'kobold leader', 'lesser god (Antar)': 'Master Kaen',
 'demon prince (Jubilex)': 'Juiblex', 'demon prince (Bone)': 'Nalzok',
 "demon prince (Graz'zt)": 'Dark One',
 'demon prince (Demogorgon)': 'Demogorgon', 'arch devil (Mammon)': 'Croesus',
 'arch devil (Baalzebul)': 'Baalzebub', 'arch devil (Moloch)': 'balrog',
 'arch devil (Dispater)': 'Dispater',
 'platinum dragon (Bahamut)': 'shimmering dragon',
 'diablero (Prithivi)': 'earth elemental', 'diablero (Apas)': 'water elemental',
 'chromatic dragon (Tiamat)': 'Chromatic Dragon',
 'diablero (Vayu)': 'air elemental', 'diablero (Tejas)': 'fire elemental',
 'etheric dragon (Ishtar)': 'gray dragon', 'diablero (Akasa)': 'energy vortex',
 'greater god (Maglubiyet)': 'Goblin King', 'greater god (Gruumsh)': 'orc-captain',
 'semi-demon (Cambion)': 'imp', 'minor demon (Dretch)': 'lemure',
 'major demon (Nabassu)': 'vrock', 'demon lord (Baphomet)': 'minotaur',
 'prince of hell (Hutijin)': 'pit fiend',
 'princess of hell (Glasya)': 'amorous demon',
 'prince of hell (Titivilus)': 'imp', 'lesser daemon (Pisco)': 'sandestin',
 'lesser daemon (Dergho)': 'hezrou', 'greater daemon (Ultro)': 'nalfeshnee',
 'lesser daemon (Hydro)': 'water demon', 'lesser daemon (Yagno)': 'bone devil',
 'greater daemon (Arcana)': 'djinni', 'oino daemon (Anthraxus)': 'Pestilence',
 'ipsissimus (Alteran)': 'Wizard of Yendor', 'boatman (Charon)': 'Charon',
 'anole': 'lizard', 'creodont': 'wolf', 'gorgosaur': 'crocodile',
 'giant cicada': 'killer bee', 'elasmosaurus': 'giant eel',
 'trilobite': 'scorpion', 'mammoth': 'mumak', 'ichthyosaur': 'shark',
 'grig': 'soldier ant', 'saber-tooth': 'tiger', 'merychippus': 'pony',
 'nematode': 'long worm', 'tussah': 'queen bee', 'theropod': 'baby crocodile',
 'sloth': 'sasquatch', 'pterodactyl': 'raven',
 'brontosaurus': 'baluchitherium', 'sauropod': 'titanothere',
 'wooly mammoth': 'mumak', 'brontops': 'titanothere', 'tricerotops': 'wumpus',
 'sinanthropus': 'neanderthal', 'stegosaurus': 'baluchitherium',
 'plesiosaurus': 'kraken', 'tyranosaurus rex': 'jabberwock',
 'anaconda': 'python', 'imperial mammoth': 'mumak',
 'zinjanthropus': 'carnivorous ape', 'positron': 'shocking sphere',
 'quartermaster': 'shopkeeper',
}
mons = re.findall(r'^\{"((?:[^"\\]|\\.)*)"', open(os.path.join(SRC, 'mons_def.c'), encoding='latin-1').read(), re.M)
mon_tiles = []
for n in mons:
    n = n.replace('\\"', '"')
    m = MON.get(n, n)
    if m not in idx and n.startswith('lesser god ('):
        m = 'Ixoth'
    if m not in idx and n.split(' (')[0] in ('incubus', 'succubus'):
        m = 'amorous demon'
    mon_tiles.append(T(m))

CLASS = ['barbarian', 'ranger', 'knight', 'wizard', 'cleric', 'rogue', 'ninja',
         'healer', 'monk', 'human']

WEAP = ['mace', 'long sword', 'bow', 'arrow', 'dagger', 'large rock',
        'two-handed sword', 'sling', 'dart', 'crossbow', 'crossbow bolt', 'spear',
        'trident', 'spetum', 'bardiche', 'ranseur', 'broadsword', 'halberd',
        'battle-axe']
ARMOR = ['leather armor', 'ring mail', 'studded leather armor', 'scale mail',
         'leather jacket', 'chain mail', 'splint mail', 'banded mail',
         'plate mail', 'bronze plate mail']
MMAG = ['clear / water', 'murky / oil', 'parchment / dig', 'elven boots',
        'leather gloves', 'bell', 'Bell of Opening', 'cloak of displacement',
        'cloak of protection', 'drum of earthquake', 'sack', 'oilskin sack',
        'gauntlets of dexterity', 'gauntlets of power', 'red / ruby',
        'can of grease', 'robe', 'gauntlets of fumbling',
        'amulet of magical breathing', 'amulet of strangulation', 'fumble boots',
        'vellum / magic missile', 'crystal ball']
RELIC = ['athame', 'cloak of magic resistance', 'amulet of life saving',
         'quarterstaff', 'jeweled', 'spiked', 'Amulet of Yendor / Amulet of Yendor',
         'magic harp', 'frost horn', 'morning star', 'flail', 'lenses', 'axe',
         'magic marker', 'amulet of reflection', 'conflict', 'credit card']
FOOD = ['food ration', 'apple', 'banana', 'sprig of wolfsbane', 'clove of garlic',
        'melon', 'kelp frond', 'eucalyptus leaf', 'carrot', 'orange', 'pear',
        'lump of royal jelly', 'orange', 'melon', 'pear', 'kelp frond', 'carrot',
        'eucalyptus leaf', 'apple', 'lump of royal jelly', 'sprig of wolfsbane',
        'slime mold']

TERRAIN = {  # char -> tile; walls/doors are chosen in tiles.c
 '.': 'floor of a room', '#': 'corridor', '%': 'staircase down',
 '^': 'throne', '>': 'trap door', '{': 'arrow trap', '$': 'sleeping gas trap',
 '}': 'bear trap', '~': 'teleportation trap', '`': 'dart trap',
 '<': 'magic portal', '"': 'pool', "'": 'level teleporter', '\\': 'tree',
 '&': 'horizontal closed door',
}
GENERIC = {  # item class char -> tile when the object isn't known
 '!': 'potion / generic potion', '?': 'scroll / generic scroll',
 ':': 'food ration', ')': 'weapon / generic weapon', ']': 'armor / generic armor',
 ';': 'tool / generic tool', ',': 'amulet / generic amulet',
 '=': 'ring / generic ring', '/': 'wand / generic wand', '*': 'gold piece',
}

def unique(ts):
    """Own slot per entry (a copy of the shared tile), so a second tile set
    (mkdawn.py) can draw each monster/item differently."""
    out = []
    for t in ts:
        if t in used:
            tiles.append(tiles[t]); names.append(names[t]); t = len(tiles) - 1
        used.add(t); out.append(t)
    return out

used = set()
def arr(name, vals):
    return 'static const short %s[] = {%s};\n' % (name, ','.join(map(str, vals)))

out = ['/* generated by port/mktiles.py from the NetHack tiles - do not edit */\n',
       '#define TILES_PER_ROW %d\n' % PER_ROW,
       arr('mon_tile', unique(mon_tiles)), arr('class_tile', [T(c) for c in CLASS]),
       arr('weap_tile', unique([T(n) for n in WEAP])), arr('armor_tile', unique([T(n) for n in ARMOR])),
       arr('mm_tile', [T(n) for n in MMAG]), arr('relic_tile', unique([T(n) for n in RELIC])),
       arr('food_tile', [T(n) for n in FOOD]),
       'static const short terrain_tile[128] = {%s};\n' % ','.join(
           str(T('T:' + TERRAIN[chr(c)])) if chr(c) in TERRAIN else '-1' for c in range(128)),
       'static const short generic_tile[128] = {%s};\n' % ','.join(
           str(T(GENERIC[chr(c)])) if chr(c) in GENERIC else '-1' for c in range(128))]
for nm, a, b in (('POTION', 'ruby / gain ability', 'murky / oil'),
                 ('SCROLL', 'ZELGO MER / enchant armor', 'STRC PRST SKRZ KRK'),
                 ('RING', 'wooden / adornment', 'shiny / protection from shape changers'),
                 ('WAND', 'glass / light', 'jeweled')):
    s, n = rng(a, b)
    out.append('#define %s_TILES %d\n#define %s_NTILES %d\n' % (nm, s, nm, n))
for k, v in (('HWALL', 'main walls horizontal'), ('VWALL', 'main walls vertical'),
             ('TL', 'main walls tlcorn'), ('TR', 'main walls trcorn'),
             ('BL', 'main walls blcorn'), ('BR', 'main walls brcorn'),
             ('HDOOR', 'horizontal open door'), ('VDOOR', 'vertical open door'),
             ('FLOOR', 'floor of a room'), ('CORR', 'corridor')):
    out.append('#define T_%s %d\n' % (k, T('T:' + v)))
img = Image.new('RGBA', (PER_ROW * 16, (len(tiles) + PER_ROW - 1) // PER_ROW * 16))
for t, rows in enumerate(tiles):
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            a = 0 if c == (71, 108, 108) else 255
            img.putpixel(((t % PER_ROW) * 16 + x, (t // PER_ROW) * 16 + y), c + (a,))
img.save(os.path.join(HERE, 'tiles.png'))

open(os.path.join(HERE, 'tilemap.h'), 'w').write(''.join(out))
print(len(tiles), 'tiles,', len(mons), 'monsters')
# raw RGBA copy for the X11 frontend (no PNG decoder needed in C)
open(os.path.join(HERE, 'tiles.rgba'), 'wb').write(
    img.size[0].to_bytes(4, 'little') + img.size[1].to_bytes(4, 'little') + img.tobytes())
