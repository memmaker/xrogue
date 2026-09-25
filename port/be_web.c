/* Browser frontend for the curses shim (RVIP step 7): web/xrogue.js draws
 * the panes (Module.xr); input waits with Asyncify. The save file doubles
 * as an autosave: kept while playing, removed when the game ends unless
 * the player saved with S. */
#include <emscripten.h>
#include <stdio.h>
#include <unistd.h>
#include <curses.h>
#include "../mach_dep.h"
#include "../rogue.h"

EM_JS(void, js_init, (int p, int c, int r), { Module.xr.init(p, c, r); });
EM_JS(void, js_put, (int p, int y, int x, int ch, int t, int u), { Module.xr.put(p, y, x, ch, t, u); });
EM_JS(void, js_cursor, (int p, int y, int x), { Module.xr.cursor(p, y, x); });
EM_JS(void, js_popup, (int r, int c), { Module.xr.popup(r, c); });
EM_JS(void, js_flush, (int lvl, int music, int hy, int hx), { Module.xr.flush(lvl, music, hy, hx); });
EM_JS(int, js_key, (void), { return Module.xr.key(); });
EM_JS(int, js_want_save, (void), { return Module.xr.wantSave(); });
EM_JS(void, js_sound, (const char *s), { Module.xr.sound(UTF8ToString(s)); });
EM_JS(void, js_end, (int saved, int dead), { Module.xr.end(saved, dead); });

void be_init(int p, int cols, int rows) { js_init(p, cols, rows); }
void be_put(int p, int y, int x, chtype ch, int tile, int under) { js_put(p, y, x, ch, tile, under); }
void be_cursor(int p, int y, int x) { js_cursor(p, y, x); }
void be_popup(int rows, int cols) { js_popup(rows, cols); }
void be_sound(const char *s) { if (*s) js_sound(s); }

void be_flush(void)
{
    /* town music on the trading post and the outside levels */
    js_flush(level, levtype == POSTLEV || levtype == OUTSIDE, hero.y - 1, hero.x);
}

/* Save without quitting, like auto_save() on SIGHUP but keep playing. */
static void autosave(void)
{
    FILE *f;
    int y, x;
    if (!file_name[0] || pstats.s_hpt <= 0 || !(f = fopen(file_name, "wb"))) return;
    getyx(cw, y, x);
    save_file(f);
    fclose(f);
    wmove(cw, y, x);
    draw(cw);
}

int be_getkey(int wait)
{
    static double last;
    int k;
    for (;;) {
        if (wc_cmd_prompt && js_want_save()) autosave();
        if ((k = js_key()) >= 0) return k;
        if (!wait) {                /* polling (explore, running): let the page paint */
            if (emscripten_get_now() - last > 50) {
                last = emscripten_get_now();
                emscripten_sleep(0);
            }
            return -1;
        }
        emscripten_sleep(10);
    }
}

void be_end(void)
{
    if (!wc_saved) unlink(file_name);   /* died or quit: the game is over */
    js_end(wc_saved, pstats.s_hpt <= 0);
}
