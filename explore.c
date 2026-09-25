/*
    explore.c  -  auto-explore ('x') and walking to the nearest known
    staircase ('<' / '>' when not on one).  Added for the RVIP port.

    Only uses what the player can see (the cw window), one step per turn.
*/

#include <curses.h>
#include "mach_dep.h"
#include "rogue.h"

#define EMAXL 128
#define EMAXC 256

int explore_mode = 0;           /* 0 off, 'x' explore, '<' / '>' stairs */
static char visited[EMAXL][EMAXC];      /* stood here */

void
explore_reset()
{
    explore_mode = 0;
    memset(visited, 0, sizeof visited);
}

static int
seen(y, x)
int y, x;
{
    if (y < 1 || y >= lines - 2 || x < 0 || x >= cols) return ' ';
    return mvwinch(cw, y, x) & A_CHARTEXT;
}

static int
is_item(c)
int c;
{
    return c == GOLD || c == POTION || c == SCROLL || c == FOOD ||
           c == WEAPON || c == ARMOR || c == MM || c == RELIC ||
           c == RING || c == STICK;
}

/* Can the explorer step here? Known, not a wall, trap, pool or monster. */
static int
walkable(y, x)
int y, x;
{
    int c = seen(y, x);
    return c == FLOOR || c == PASSAGE || c == DOOR || c == STAIRS ||
           c == FOREST || c == PLAYER || c == IPLAYER || is_item(c) ||
           (y == hero.y && x == hero.x);
}

/* Diagonal moves follow diag_ok(): not when exactly one side is open. */
static int
diag_open(y, x, ny, nx)
int y, x, ny, nx;
{
    if (y == ny || x == nx) return TRUE;
    return walkable(ny, x) == walkable(y, nx);
}

static int
is_target(y, x)
int y, x;
{
    int dy, dx, c = seen(y, x);

    if (explore_mode == '<' || explore_mode == '>')
        return c == STAIRS;
    /* dark corridors and rooms only show what is next to you: a cell at
     * the edge of the unknown stays a target until you stood on it */
    if (visited[y][x]) return FALSE;
    if (is_item(c)) return TRUE;
    for (dy = -1; dy <= 1; dy++)
        for (dx = -1; dx <= 1; dx++)
            if (seen(y + dy, x + dx) == ' ' &&
                y + dy >= 1 && y + dy < lines - 2 &&
                x + dx >= 0 && x + dx < cols)
                return TRUE;
    return FALSE;
}

/* A monster the player can see (not a friend) stops everything. */
int
monster_in_view()
{
    struct linked_list *item;
    struct thing *tp;

    for (item = mlist; item != NULL; item = next(item)) {
        tp = THINGPTR(item);
        if (on(*tp, ISFRIENDLY)) continue;
        if (seen(tp->t_pos.y, tp->t_pos.x) == tp->t_type) return TRUE;
    }
    return FALSE;
}

static char dirkey[3][3] = { { 'y', 'k', 'u' }, { 'h', '.', 'l' }, { 'b', 'j', 'n' } };

/*
 * explore_step:
 *      The next command for auto-explore / stair walking, or 0 when it
 *      stops (with a message saying why).
 */
int
explore_step()
{
    static short qy[EMAXL * EMAXC], qx[EMAXL * EMAXC];
    static signed char from[EMAXL][EMAXC];  /* first step dir index, -1 unseen */
    int head = 0, tail = 0, y, x, dy, dx, mode = explore_mode;

    if (!mode) return 0;
    if (mpos != 0) {                /* something happened: stop and look */
        explore_mode = 0;
        return 0;
    }
    if (wc_kbhit()) {               /* any key stops it */
        flushinp();
        explore_mode = 0;
        return 0;
    }
    if (monster_in_view()) {
        explore_mode = 0;
        msg(mode == 'x' ? "You see a monster; exploring stops."
                        : "You see a monster; you stop walking.");
        return 0;
    }
    if (lines > EMAXL || cols > EMAXC) { explore_mode = 0; return 0; }

    visited[hero.y][hero.x] = TRUE;

    if ((mode == '<' || mode == '>') &&
        (mvwinch(stdscr, hero.y, hero.x) & A_CHARTEXT) == STAIRS) {
        explore_mode = 0;
        return mode;                /* take them */
    }

    memset(from, -1, sizeof from);
    from[hero.y][hero.x] = 4;
    qy[tail] = hero.y; qx[tail++] = hero.x;
    while (head < tail) {
        y = qy[head]; x = qx[head++];
        if ((y != hero.y || x != hero.x) && is_target(y, x)) {
            int d = from[y][x];
            return dirkey[d / 3][d % 3];
        }
        for (dy = -1; dy <= 1; dy++)
            for (dx = -1; dx <= 1; dx++) {
                int ny = y + dy, nx = x + dx;
                if ((!dy && !dx) || ny < 1 || ny >= lines - 2 || nx < 0 || nx >= cols)
                    continue;
                if (from[ny][nx] >= 0 || !walkable(ny, nx) || !diag_open(y, x, ny, nx))
                    continue;
                from[ny][nx] = (y == hero.y && x == hero.x) ? (dy + 1) * 3 + dx + 1
                                                            : from[y][x];
                qy[tail] = ny; qx[tail++] = nx;
            }
    }
    explore_mode = 0;
    if (mode == 'x')
        msg("Nothing left to explore. Search (s) for secret doors, or take the stairs (>).");
    else
        msg("You don't know where any stairs are yet.");
    return 0;
}

/*
 * explore_stairs:
 *      '<' or '>' pressed. TRUE if the player is where the command works
 *      as before (on stairs or another way through); otherwise start
 *      walking to the nearest known staircase and return FALSE.
 */
int
explore_stairs(key)
int key;
{
    int c = mvwinch(stdscr, hero.y, hero.x) & A_CHARTEXT;

    if (c == STAIRS || c == WORMHOLE || on(player, CANINWALL) ||
        (key == '>' && (c == POST || c == POOL || c == TRAPDOOR)))
        return TRUE;
    explore_mode = key;
    return FALSE;
}
