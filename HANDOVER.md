# XRogue 8.0.3 — RVIP handover

State as of 2026-09-25 (second session: panes, explore fix, Enter menu,
inventory cursor, ASan, save fixes). Source: `~/Downloads/xrogue8.0.3-src.tar.gz`, unpacked
here and committed as the first git commit ("xrogue 8.0.3 upstream"), so
`git diff` shows every change made for the port.

XRogue is a **curses** game (Rogue → Advanced Rogue → XRogue), not an
Angband variant: no z-term, no subwindows, no pref files. RVIP steps were
adapted accordingly (see "Rogue variants" in `~/Games/rvip-tools/RVIP.md`).

## Build / run

```sh
cd ~/Games/xrogue
make xrogue-x11          # macOS + XQuartz, curses shim + NetHack tiles
python3 port/mktiles.py  # regenerate port/tiles.png, tiles.rgba, tilemap.h
```
`make xrogue` (plain ncurses, terminal) still builds with the old flags
(`CFLAGS="-std=gnu89 -w -Wno-…" CRLIB=-lncurses`), but it is not the target.

Runtime env: `HOME` = where `xrogue.sav` goes (fixed: `md_gethomedir()`
used the passwd entry and ignored `$HOME`, so saves always went to `~`), `ROGUEHOME` = score file dir
(play.sh must set both to folders inside `~/Games/xrogue`),
`XROGUE_CELL` (default 18), `XROGUE_TILES`, `XROGUE_XFT`
(font family, default Menlo), `XROGUE_TEXT` (text px, 14),
`XROGUE_MAP` / `_MSG` / `_STATUS` / `_INV` = `x,y` window positions,
`XROGUE_DUMP=<file>` (writes every pane as text on every refresh — used for testing), `XROGUE_KEYLOG`, `XROGUE_TILELOG`.
Don't use `ROGUEOPTS=name=…`: upstream option parsing is buggy.

## What was done

### Compile fixes (game code)
- `struct delayed_action` was defined differently in `daemon.c` and
  `state.c`; now one definition (with the `d_arg` union) in `rogue.h`.
- **arm64 ABI:** `msg()`/`addmsg()` are variadic and were called without
  prototypes → garbage arguments (quest item printed as "felix"). Prototypes
  plus `<stdlib.h>/<string.h>` added at the end/top of `rogue.h`.
  `daemon` renamed via `#define daemon xr_daemon` (clash with libc).
- `!` (shell escape) removed: it also fell through into "move left".
- Flags: `-std=gnu89 -w -Wno-implicit-function-declaration -Wno-implicit-int
  -Wno-return-type -Wno-int-conversion -Wno-incompatible-pointer-types`.
- **Still open for the web build:** ~246 implicitly declared functions.
  WebAssembly traps on signature mismatches, so expect to generate a full
  prototype header (or fix per the rogue2wasm "Code fixes" section).

### Curses shim (`port/`)
- `curses.h` / `wcurses.c`: in-memory WINDOWs with real curses refresh
  semantics (per-line changed ranges, `touchwin`, `overlay`/`overwrite`,
  `clearok`). Found via `-Iport`, so game sources are untouched.
- `wrefresh()` hands changed cells to a frontend (`be_*` functions);
  cells of the map window get a tile from `tile_for()`.
- `printf` → `wc_printf` (the score list is printed after `endwin`) and
  `exit` → `wc_exit` (waits for a key so the window doesn't vanish).
- `wc_kbhit()` lets auto-explore stop on any key.
- Map vs text: rows of the map window containing 3+ non-terrain
  characters with no real monster/object under them are text (the start
  shop prints help text inside the map area).

### Tiles (`port/mktiles.py`, `port/tiles.c`)
- NetHack 3.7 `win/share/{monsters,objects,other}.txt` (downloaded to
  `port/nethack/`) → `tiles.png` (16×16, 32/row, background colour
  71,108,108 → transparent) and `tilemap.h`.
- Hand mapping of all 212 monsters, 9 classes (+monster), weapons, armour,
  misc magic, relics, foods. Potions/scrolls/rings/wands: hash of the
  random appearance name into NetHack's appearance tiles.
- `tile_for()` looks up the real monster (`mlist`, only if the shown char
  equals `t_type`, so mimics stay disguised) or object (`lvl_obj`); falls
  back to the first monster with that letter / generic class tile.
  Walls pick corner tiles from neighbours; doors pick orientation.
  Sprites composite over the floor from `stdscr` (the real map).
  **Never use `mvwinch` in tile code** — it moves the window cursor.

### X11 frontend (`port/be_x11.c`)
- Square cells (18 px), tiles scaled nearest-neighbour, text in Menlo Bold
  via Xft, horizontally stretched to fill the square cell (user found the
  9×18 bitmap font unreadable).
- Keypad → `KEY_*` (game already handles them as moves), KP_5 → `KEY_B2`.

### Gameplay (RVIP 2/3)
- `explore.c`: `x` = auto-explore (BFS over the player's view `cw`,
  targets = unvisited items and cells next to unknown space, diagonal rule
  copied from `diag_ok`, stops on visible non-friendly monster, any
  message, any key). `<`/`>` off stairs walk to the nearest known `%`
  (XRogue's stairs go both ways) and take it; on stairs/trapdoor/pool/
  post/wormhole or when phasing, the original command runs.
  Reset in `new_level()`. Help list (`help.c`) updated. Tested in session 2 (see Explore fix).

### Panes (done, session 2)
Routing in `wrefresh()` (`port/wcurses.c`) by window:

| game window | goes to |
|---|---|
| `cw` rows 1..lines-3 | Map window (tiles); rows that are words (shop help) are blanked and sent to Messages once |
| `cw` last two rows (`status()`) | Status window |
| `msgw` | Messages window: 14 history rows + the 4 live rows (a message enters the history when row 0 changes to something that isn't an extension of it) |
| anything else (`hw`, `stdscr`, `over_win` copies) | pop-up: override-redirect window over the map, sized to the bounding box of cells that differ from `cw` (+ prompt cursor), 1 char padding; closed by the next `cw` refresh that changed something |
| — | Inventory window, rebuilt from the pack (`wc_inv()` in `tiles.c`, saves/restores `prbuf`) |

Backend API: `be_init(pane,…)`, `be_put(pane,…)`, `be_cursor(pane,…)`,
`be_popup(rows, cols)`. Default layout in `place()` (`be_x11.c`): map on top
at 0,0, Messages + Status below on the left, Inventory on the right.

### Explore fix
A frontier cell stays a target until the hero **stood on** it (the old
"stood next to it" rule stopped at every door and corridor end). Tested:
crosses corridors, stops for monsters, `>` walks to stairs in the shop.

### Enter menu (3b, done)
`cmd_menu()` in `help.c`: groups = blank-line blocks of `helpstr[]`
(`cmd_groups[]` names them), then the group's commands; returns the key into
`command()`. Shared `menu()` (cursor, scroll, letters, numpad) is also used
by 3c. Shell-escape entry removed from the help list; long entries shortened
(the help list is two 40-column halves).

### Inventory (3c, done)
- `i` → `inv_menu()` (`help.c`): letter / `+` = main action, `-` drop,
  Enter/5 = action menu (`item_actions()`), Esc/0/. close. The chosen item
  goes to `inv_pick`, which `get_item()` returns to the command, so every
  command keeps its own checks. `inv_again` reopens the list unless a
  monster is in view.
- Every `get_item()` prompt with a purpose shows the cursor list
  (`pack.c`). No equipment/floor lists to switch in XRogue; no Examine
  command, so `*` / Ctrl+letter do nothing extra. Shift+letter isn't drop
  (item 27 is `A`).

### ASan (done)
Full session (shop, menus, explore, save, restore) under ASan: no reports.
Found instead: `rs_read_long/ulong` read 4 bytes into an 8-byte `long`
(gold/exp garbage after restore) → fixed; saves ignored `$HOME` → fixed.
ASan binary and objects removed.

### Launcher, Desktop app, docs (done, session 3)
- `play.sh`: `HOME`/`ROGUEHOME` = `save/`; continues `save/xrogue.sav` if
  it exists. Layout fits 1440×932 (map 0,0; Messages 20+4 rows and Status
  below it on the left; Inventory 28 rows on the right).
- `~/Desktop/Games/Roguelikes/XRogue.app` (osacompile), icon = NetHack
  fighter tile 339, nearest-neighbour.
- Docs: `xrogue.html` entry in `build-docs.py` (key list parsed from
  `helpstr[]` by `parse_helpstr()`), guide + saving in `guides.py`.

### Web (done, session 3): https://ruzzoli.de/roguelikes/xrogue/
- `port/be_web.c` (EM_JS → `Module.xr` in `web/xrogue.js`), input via
  Asyncify (`emscripten_sleep`). Panes have fixed cols/rows, so no z-term
  resize pipeline: a window smaller than its pane scales the canvas down.
- Map zoom goes up to 96 px tiles; the map never shrinks: when bigger than
  its window it scrolls to keep the hero in the middle half
  (`scrollMap()`, hero position passed by `be_flush()`).
- Page: `web/index.html` (Quickband's styles), tiling map / Messages /
  Status / Inventory with 3 draggable gutters, pop-up canvas over the map,
  Zoom ± (map tiles), A−/A+ per text window, Reset windows, Help
  (`web/make-help.py` from the Docs page), Sound/Music off by default,
  Export/Import save, New game, crash message, leave warning.
- Saves: IDBFS at `/xrogue/save` (`HOME`/`ROGUEHOME` via `ENV`). Web only:
  restore doesn't delete the file (it's the autosave), `main()` continues
  it, `autosave()` in `be_web.c` runs every 2 min / on tab hide while the
  game waits for a command (`wc_cmd_prompt`), `be_end()` deletes it unless
  the player saved with `S` (`wc_saved` set in `save_game()`).
- Sound: XRogue has no events; `SOUNDS` regexes in `xrogue.js` map message
  text (`be_message()` from the shim) to Dubtrain events, level changes to
  stairs; `web/sounds.py` copies only the used samples + `sounds.json`.
  Music (`new_town.ogg`) on trading-post and outside levels.
- wasm fixes: `void` prototypes for `picky_inven`, `init_terrain`,
  `do_terrain`, `explore_reset`; `give(NULL)`/`fright(NULL)`;
  `-sEMULATE_FUNCTION_POINTER_CASTS` for the ~36 daemon/fuse callbacks
  (0-arg functions called with 1 arg) — `ponytail:` note in `build.sh`.
- Build `sh web/build.sh`, deploy `sh web/deploy.sh`; the generic nginx
  `location ^~ /roguelikes/` block already covers it. Card + `xrogue.png`
  added to `~/Games/roguelikes-index`.
- Tested locally and live: birth, shop, Enter menu pop-up, explore,
  `S` save → reload → "Welcome back", autosave mid-game, `Q` quit deletes
  the save, Help (6 sections), sound toggle, layout file persisted, no
  console errors.

## Open / nice to have
- Mouse clicks (menus, walk to a map cell).
- Give each daemon/fuse function a real `(arg)` signature, then drop
  `EMULATE_FUNCTION_POINTER_CASTS`.
- A monster recall / visible-monsters pane.

## Testing notes
- Test script pattern: start with isolated `HOME`, find the window with
  `xwininfo -root -tree | grep '"XRogue"'`, send keys with
  `~/Games/rvip-tools/xsend`, read `XROGUE_DUMP` text instead of
  screenshots where possible. Character creation: `1` (class), `Escape`
  (max remaining stats), `y`.
- The game ignores SIGTERM; kill your own test PID with `-9`.
- xsend takes keysym names: `Return`, `Escape`, `numbersign`, `greater`,
  `question`, `asterisk`, `space`, `Down`.
- `state.c` and `main.c` have some CRLF lines: edit them in binary / with
  sed, not Python text mode (it silently converts).
- Scratch test helper used in session 2 (not in the repo): start with
  isolated HOME, `buy` = walk along the hero's row to the nearest shop item
  and `#` `y`.

## Source and changes

- Base: **XRogue 8.0.3**
- Original source: https://github.com/memmaker/xrogue/tree/544e05a (memmaker/xrogue master, commit 544e05a (dump of the original svn r1490))
- Our changes: https://github.com/memmaker/xrogue/compare/master...rvip-port (memmaker/xrogue, branch rvip-port)
