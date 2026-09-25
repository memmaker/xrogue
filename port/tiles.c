/* Which NetHack tile shows a map cell (RVIP step 4). The screen only has
 * characters, so look up the monster/object that is really there. */
#include <curses.h>
#include <string.h>
#include "../mach_dep.h"
#include "../rogue.h"
#include "tilemap.h"

static int hash_tile(const char *s, int first, int n)
{
    unsigned h = 5381;
    if (!s) return first;
    while (*s) h = h * 33 + (unsigned char)*s++;
    return first + h % n;
}

static int obj_tile(struct object *o)
{
    int w = o->o_which;
    switch (o->o_type) {
    case WEAPON: return w >= 0 && w < MAXWEAPONS ? weap_tile[w] : -1;
    case ARMOR:  return w >= 0 && w < MAXARMORS ? armor_tile[w] : -1;
    case MM:     return w >= 0 && w < MAXMM ? mm_tile[w] : -1;
    case RELIC:  return w >= 0 && w < MAXRELIC ? relic_tile[w] : -1;
    case FOOD:   return w >= 0 && w < MAXFOODS ? food_tile[w] : -1;
    case POTION: return w >= 0 && w < MAXPOTIONS ? hash_tile(p_colors[w], POTION_TILES, POTION_NTILES) : -1;
    case SCROLL: return w >= 0 && w < MAXSCROLLS ? hash_tile(s_names[w], SCROLL_TILES, SCROLL_NTILES) : -1;
    case RING:   return w >= 0 && w < MAXRINGS ? hash_tile(r_stones[w], RING_TILES, RING_NTILES) : -1;
    case STICK:  return w >= 0 && w < MAXSTICKS ? hash_tile(ws_made[w], WAND_TILES, WAND_NTILES) : -1;
    }
    return -1;
}

static int by_letter(int ch)
{
    int i;
    for (i = 1; i <= NUMMONST; i++)
        if (monsters[i].m_appear == ch) return mon_tile[i];
    return -1;
}

/* Neighbours come from the real map (stdscr), so a monster or the player
   standing next to a wall does not change its shape. */
static int real(int y, int x)
{
    return (y < 1 || y >= LINES - 2 || x < 0 || x >= COLS) ? ' ' : stdscr->c[y * stdscr->maxx + x] & A_CHARTEXT;
}

#define HWALLISH(c) ((c) == HORZWALL || (c) == DOOR || (c) == SECRETDOOR)
#define VWALLISH(c) ((c) == VERTWALL || (c) == DOOR || (c) == SECRETDOOR)

static int terrain(int y, int x, int ch)
{
    switch (ch) {
    case HORZWALL:
        if (HWALLISH(real(y, x - 1)) && HWALLISH(real(y, x + 1))) return T_HWALL;
        if (VWALLISH(real(y + 1, x)))
            return HWALLISH(real(y, x + 1)) ? T_TL : T_TR;
        if (VWALLISH(real(y - 1, x)))
            return HWALLISH(real(y, x + 1)) ? T_BL : T_BR;
        return T_HWALL;
    case VERTWALL: return T_VWALL;
    case DOOR: return T_FLOOR;   /* Rogue doors are just gaps in the wall */
    }
    return ch < 128 ? terrain_tile[ch] : -1;
}

/* The floor under a monster or item: what the real map (stdscr) has. */
static int floor_under(int y, int x)
{
    int c = stdscr->c[y * stdscr->maxx + x] & A_CHARTEXT;
    if (c == PASSAGE) return T_CORR;
    if (c == DOOR) return T_FLOOR;
    if (c < 128 && terrain_tile[c] >= 0 && c != SECRETDOOR) return terrain_tile[c];
    return levtype == MAZELEV || c == ' ' ? T_CORR : T_FLOOR;
}

int tile_for_(int y, int x, int ch, int *under);
int tile_for(int y, int x, int ch, int *under)
{
    int t = tile_for_(y, x, ch, under);
    if (getenv("XROGUE_TILELOG") && !isalpha(ch)) fprintf(stderr, "%d,%d %c -> %d/%d\n", y, x, ch, t, *under);
    return t;
}
int tile_for_(int y, int x, int ch, int *under)
{
    struct linked_list *l;
    int t;

    *under = -1;
    if (!cw || ch == ' ' || ch >= 128) return -1;
    if (ch == PLAYER || ch == IPLAYER) {
        if (y != hero.y || x != hero.x) return -1;
        *under = floor_under(y, x);
        return class_tile[player.t_ctype >= 0 && player.t_ctype <= C_MONSTER ? player.t_ctype : C_FIGHTER];
    }
    if (isalpha(ch)) {
        *under = floor_under(y, x);
        if (1)
            for (l = mlist; l; l = next(l)) {
                struct thing *tp = THINGPTR(l);
                if (tp->t_pos.y == y && tp->t_pos.x == x && tp->t_type == ch
                    && tp->t_index >= 0 && tp->t_index <= NUMMONST)
                    return mon_tile[tp->t_index];
            }
        return by_letter(ch);
    }
    if (generic_tile[ch] >= 0) {
        *under = floor_under(y, x);
        if (1)
            for (l = lvl_obj; l; l = next(l)) {
                struct object *o = OBJPTR(l);
                if (o->o_pos.y == y && o->o_pos.x == x && o->o_type == ch
                    && (t = obj_tile(o)) >= 0)
                    return t;
            }
        if (ch != GOLD || (stdscr->c[y * stdscr->maxx + x] & A_CHARTEXT) == GOLD) return generic_tile[ch];
        *under = -1;          /* '*' without gold: a bolt, draw as text */
        return -1;
    }
    return terrain(y, x, ch);
}

int wc_is_thing(int y, int x)
{
    struct linked_list *l;
    if (hero.y == y && hero.x == x) return 1;
    for (l = mlist; l; l = next(l))
        if ((THINGPTR(l))->t_pos.y == y && (THINGPTR(l))->t_pos.x == x) return 1;
    for (l = lvl_obj; l; l = next(l))
        if ((OBJPTR(l))->o_pos.y == y && (OBJPTR(l))->o_pos.x == x) return 1;
    return 0;
}

/* Inventory pane: the pack, lettered like inventory(), plus gold.
 * inv_name() writes the game's shared prbuf, so keep it intact. */
void wc_inv(WINDOW *p)
{
    char save[LINELEN * 2];
    struct linked_list *l;
    int y = 0, ch = 'a';

    memcpy(save, prbuf, sizeof save);
    for (l = pack; l && y < p->maxy - 1; l = next(l), y++, ch = ch == 'z' ? 'A' : ch + 1) {
        mvwprintw(p, y, 0, "%c) %s", ch, inv_name(OBJPTR(l), FALSE));
        wclrtoeol(p);
    }
    for (; y < p->maxy - 1; y++) { wmove(p, y, 0); wclrtoeol(p); }
    mvwprintw(p, y, 0, "%d/%d items, %ld gold", inpack, MAXPACK, purse);
    wclrtoeol(p);
    memcpy(prbuf, save, sizeof save);
}
