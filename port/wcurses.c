/* In-memory curses. wrefresh() copies the window's changed lines to the
 * screen (curscr) like real curses, then hands changed cells to the
 * frontend with the tile to draw (tile_for) for map cells. */
#define WCURSES_IMPL
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "curses.h"

WINDOW *stdscr, *curscr, *wc_mapwin;
int wc_cmd_prompt, wc_saved;
int LINES = 24, COLS = 80;
static int ended = 1, attr;
static chtype *shown;       /* what the frontend has, per cell */
static int *shown_tile;
#define HIST 20             /* message history rows */
#define MAXINV 28           /* 27 pack slots + a gold line */
static WINDOW *pn[NPANES];

WINDOW *newwin(int rows, int cols, int by, int bx)
{
    WINDOW *w = calloc(1, sizeof *w);
    if (!rows) rows = LINES - by;
    if (!cols) cols = COLS - bx;
    w->maxy = rows; w->maxx = cols; w->begy = by; w->begx = bx;
    w->c = malloc(sizeof(chtype) * rows * cols);
    w->first = malloc(sizeof(short) * rows);
    w->last = malloc(sizeof(short) * rows);
    werase(w);
    w->clear = 0;
    return w;
}

int delwin(WINDOW *w)
{
    if (!w) return ERR;
    free(w->c); free(w->first); free(w->last); free(w);
    return OK;
}

WINDOW *initscr(void)
{
    char *e;
    int i;
    if ((e = getenv("XROGUE_COLS"))) COLS = atoi(e);
    if ((e = getenv("XROGUE_LINES"))) LINES = atoi(e);
    if (!curscr) {
        curscr = newwin(LINES, COLS, 0, 0);
        stdscr = newwin(LINES, COLS, 0, 0);
        shown = malloc(sizeof(chtype) * LINES * COLS);
        shown_tile = malloc(sizeof(int) * LINES * COLS);
        memset(shown, 0xff, sizeof(chtype) * LINES * COLS);
        pn[P_STATUS] = newwin(2, COLS, 0, 0);
        pn[P_MSG] = newwin(HIST + 4, COLS, 0, 0);
        pn[P_INV] = newwin(MAXINV, COLS, 0, 0);
        be_init(P_MAP, COLS, LINES - 3);
        be_init(P_MSG, COLS, HIST + 4);  /* before Status, which goes below it */
        be_init(P_STATUS, COLS, 2);
        be_init(P_INV, COLS, MAXINV);
    }
    ended = 0;
    return stdscr;
}

int endwin(void) { ended = 1; return OK; }
int isendwin(void) { return ended; }

static void touch(WINDOW *w, int y, int x)
{
    if (w->first[y] < 0 || x < w->first[y]) w->first[y] = x;
    if (x > w->last[y]) w->last[y] = x;
}

int wmove(WINDOW *w, int y, int x)
{
    if (!w || y < 0 || x < 0 || y >= w->maxy || x >= w->maxx) return ERR;
    w->cury = y; w->curx = x;
    return OK;
}

int waddch(WINDOW *w, chtype ch)
{
    int y = w->cury, x = w->curx, c = ch & A_CHARTEXT;
    if (c == '\n') {
        wclrtoeol(w);
        if (y + 1 < w->maxy) { w->cury++; w->curx = 0; }
        return OK;
    }
    if (c == '\r') { w->curx = 0; return OK; }
    if (c == '\t') {
        do waddch(w, ' '); while (w->curx % 8 && w->curx);
        return OK;
    }
    if (c == '\b') { if (x) w->curx--; return OK; }
    if (c < ' ' && c) {        /* control chars as ^X, like curses */
        waddch(w, '^');
        return waddch(w, c + '@');
    }
    ch = c | (ch & A_STANDOUT) | attr;
    if (w->c[y * w->maxx + x] != ch) {
        w->c[y * w->maxx + x] = ch;
        touch(w, y, x);
    }
    if (++w->curx >= w->maxx) {
        if (y + 1 < w->maxy) { w->cury++; w->curx = 0; }
        else { w->curx = w->maxx - 1; return ERR; }
    }
    return OK;
}

int waddstr(WINDOW *w, const char *s)
{
    while (*s) waddch(w, (unsigned char)*s++);
    return OK;
}

int vwprintw(WINDOW *w, const char *f, va_list ap)
{
    char buf[2048];
    vsnprintf(buf, sizeof buf, f, ap);
    return waddstr(w, buf);
}

int wprintw(WINDOW *w, const char *f, ...)
{
    va_list ap; int r;
    va_start(ap, f); r = vwprintw(w, f, ap); va_end(ap);
    return r;
}

int printw(const char *f, ...)
{
    va_list ap; int r;
    va_start(ap, f); r = vwprintw(stdscr, f, ap); va_end(ap);
    return r;
}

int mvprintw(int y, int x, const char *f, ...)
{
    va_list ap; int r;
    if (wmove(stdscr, y, x) == ERR) return ERR;
    va_start(ap, f); r = vwprintw(stdscr, f, ap); va_end(ap);
    return r;
}

int mvwprintw(WINDOW *w, int y, int x, const char *f, ...)
{
    va_list ap; int r;
    if (wmove(w, y, x) == ERR) return ERR;
    va_start(ap, f); r = vwprintw(w, f, ap); va_end(ap);
    return r;
}

chtype winch(WINDOW *w) { return w->c[w->cury * w->maxx + w->curx]; }

int wclrtoeol(WINDOW *w)
{
    int x, y = w->cury;
    for (x = w->curx; x < w->maxx; x++)
        if (w->c[y * w->maxx + x] != ' ') {
            w->c[y * w->maxx + x] = ' ';
            touch(w, y, x);
        }
    return OK;
}

int wclrtobot(WINDOW *w)
{
    int y, cy = w->cury, cx = w->curx;
    wclrtoeol(w);
    for (y = cy + 1; y < w->maxy; y++) { w->cury = y; w->curx = 0; wclrtoeol(w); }
    w->cury = cy; w->curx = cx;
    return OK;
}

int werase(WINDOW *w)
{
    int i;
    for (i = 0; i < w->maxy * w->maxx; i++) w->c[i] = ' ';
    w->cury = w->curx = 0;
    return touchwin(w);
}

int wclear(WINDOW *w) { werase(w); w->clear = 1; return OK; }
int clearok(WINDOW *w, int b) { w->clear = b; return OK; }

int touchwin(WINDOW *w)
{
    int y;
    for (y = 0; y < w->maxy; y++) { w->first[y] = 0; w->last[y] = w->maxx - 1; }
    return OK;
}

static int copywin(WINDOW *s, WINDOW *d, int blanks)
{
    int y, x;
    for (y = 0; y < s->maxy; y++) {
        int dy = y + s->begy - d->begy;
        if (dy < 0 || dy >= d->maxy) continue;
        for (x = 0; x < s->maxx; x++) {
            int dx = x + s->begx - d->begx;
            chtype ch = s->c[y * s->maxx + x];
            if (dx < 0 || dx >= d->maxx) continue;
            if (!blanks && (ch & A_CHARTEXT) == ' ') continue;
            if (d->c[dy * d->maxx + dx] != ch) {
                d->c[dy * d->maxx + dx] = ch;
                touch(d, dy, dx);
            }
        }
    }
    return OK;
}

int overlay(WINDOW *s, WINDOW *d) { return copywin(s, d, 0); }
int overwrite(WINDOW *s, WINDOW *d) { return copywin(s, d, 1); }

/* Rows of the map window that hold words (the start level's help text)
 * are text, not map: 3 non-terrain characters in a row with nothing
 * real (monster, object) under them. */
int wc_is_thing(int y, int x);    /* tiles.c: monster/object/hero there */
static int text_row(WINDOW *w, int y)
{
    int x, run = 0;
    for (x = 0; x < w->maxx; x++) {
        int c = w->c[y * w->maxx + x] & A_CHARTEXT;
        if (c != ' ' && !strchr(".#-|+%", c) && !wc_is_thing(y, x)) {
            if (++run >= 3) return 1;
        } else run = 0;
    }
    return 0;
}

/* Panes. Map: cw rows 1..LINES-3, tiled, cached in shown[]. Status: cw's
 * last two rows. Messages: history + the live message window. Inventory:
 * built from the pack. Pop-up: any other window (hw, stdscr, over_win's
 * copies of cw), cut to the cells that differ from cw. */
static int pop_h, pop_w;
static char last0[512];     /* message line as last seen */
extern char *morestr;

static void pset(WINDOW *p, int y, int x, chtype ch)
{
    if (y < 0 || x < 0 || y >= p->maxy || x >= p->maxx || p->c[y * p->maxx + x] == ch) return;
    p->c[y * p->maxx + x] = ch;
    touch(p, y, x);
}

static void pflush(int i)
{
    WINDOW *p = pn[i];
    int y, x;
    for (y = 0; p && y < p->maxy; y++) {
        if (p->first[y] < 0) continue;
        for (x = p->first[y]; x <= p->last[y]; x++) be_put(i, y, x, p->c[y * p->maxx + x], -1, -1);
        p->first[y] = p->last[y] = -1;
    }
}

static void put(int y, int x, chtype ch, int map)
{
    int i = y * COLS + x, under = -1;
    int t = map ? tile_for(y, x, ch & A_CHARTEXT, &under) : -1;
    int key = t < 0 ? -1 : t | (under + 1) << 16;
    if (shown[i] == ch && shown_tile[i] == key) return;
    shown[i] = ch; shown_tile[i] = key;
    be_put(P_MAP, y - 1, x, ch, t, t < 0 ? -1 : under);
}

static void untouch(WINDOW *w)
{
    int y;
    for (y = 0; y < w->maxy; y++) w->first[y] = w->last[y] = -1;
    w->clear = 0;
}

static void close_popup(void)
{
    if (pop_h) be_popup(0, 0);
    pop_h = pop_w = 0;
}

static void hist(const char *);

static void map_refresh(WINDOW *w)
{
    static char maptext[512][512];  /* text rows already sent to Messages */
    static char trow[512];
    int y, x, changed = w->clear || curscr->clear;
    for (y = 0; y < w->maxy; y++) changed |= w->first[y] >= 0;
    if (changed) close_popup();
    if (w->clear || curscr->clear) memset(shown, 0xff, sizeof(chtype) * LINES * COLS);
    curscr->clear = 0;
    untouch(w);
    for (y = 1; y < LINES - 2 && y < 512; y++) {
        char r[512];
        int n;
        trow[y] = text_row(w, y);
        /* words in the map (the shop's help): into the Messages pane */
        for (n = x = 0; trow[y] && x < COLS && x < 511; x++)
            if ((r[x] = w->c[y * COLS + x] & A_CHARTEXT) != ' ') n = x + 1;
        r[trow[y] ? n : 0] = 0;
        if (*r && strcmp(r, maptext[y])) hist(r);
        strcpy(maptext[y], r);
    }
    /* every cell: monsters/objects under unchanged chars may have changed */
    for (y = 1; y < LINES - 2; y++)
        for (x = 0; x < COLS; x++) put(y, x, trow[y] ? ' ' : w->c[y * COLS + x], !trow[y]);
    for (y = 0; y < 2; y++)
        for (x = 0; x < COLS; x++) pset(pn[P_STATUS], y, x, w->c[(LINES - 2 + y) * COLS + x]);
    wc_inv(pn[P_INV]);
    if (w->cury >= 1 && w->cury < LINES - 2) be_cursor(P_MAP, w->cury - 1, w->curx);
    else be_cursor(-1, 0, 0);
}

/* a repeat of the newest history line becomes "line (xN)" in its row */
static void hist(const char *s)
{
    static char prev[512];
    static int reps;
    char buf[560];
    WINDOW *p = pn[P_MSG];
    int y, x, n;
    if (*prev && !strcmp(s, prev)) snprintf(buf, sizeof buf, "%s (x%d)", s, ++reps);
    else {
        reps = 1;
        snprintf(prev, sizeof prev, "%s", s);
        snprintf(buf, sizeof buf, "%s", s);
        for (y = 0; y < HIST - 1; y++)
            for (x = 0; x < p->maxx; x++) pset(p, y, x, p->c[(y + 1) * p->maxx + x]);
    }
    n = strlen(buf);
    for (x = 0; x < p->maxx; x++) pset(p, HIST - 1, x, x < n ? (unsigned char)buf[x] : ' ');
}

static void msg_refresh(WINDOW *w)
{
    char r[512], *m;
    int y, x, n = 0;
    for (x = 0; x < w->maxx && x < 511; x++) r[x] = w->c[x] & A_CHARTEXT;
    for (r[x] = 0; x && r[x - 1] == ' '; ) r[--x] = 0;
    be_prompt(r);                   /* the prompt line over the map */
    if (morestr && (m = strstr(r, morestr))) *m = 0;
    for (n = strlen(r); n && r[n - 1] == ' '; ) r[--n] = 0;
    /* a message went away (not just grew): into the history */
    if (*last0 && strncmp(r, last0, strlen(last0))) hist(last0);
    strcpy(last0, r);
    for (y = 0; y < w->maxy && y < 4; y++)
        for (x = 0; x < w->maxx; x++) {
            chtype ch = w->c[y * w->maxx + x];
            int sy = y + w->begy, sx = x + w->begx;
            if (y && wc_mapwin && ch == wc_mapwin->c[sy * COLS + sx]) ch = ' ';
            pset(pn[P_MSG], HIST + y, x, ch);
        }
    untouch(w);
    be_cursor(P_MSG, HIST + w->cury, w->curx);
}

static void pop_refresh(WINDOW *w)
{
    int y, x, y0 = 1 << 30, y1 = -1, x0 = 1 << 30, x1 = -1;
    for (y = 0; y < w->maxy; y++)
        for (x = 0; x < w->maxx; x++) {
            chtype ch = w->c[y * w->maxx + x];
            int sy = y + w->begy, sx = x + w->begx;
            if ((ch & A_CHARTEXT) == ' ') continue;
            if (wc_mapwin && sy >= 0 && sy < LINES && sx >= 0 && sx < COLS
                && ch == wc_mapwin->c[sy * COLS + sx]) continue;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
        }
    untouch(w);
    if (y1 < 0) { close_popup(); be_cursor(-1, 0, 0); return; }
    /* room for the cursor of a prompt ("Which one? _") */
    if (w->cury >= y0 && w->cury <= y1 && w->curx > x1 && w->curx < w->maxx) x1 = w->curx;
    if (y1 - y0 + 1 != pop_h || x1 - x0 + 1 != pop_w) {
        pop_h = y1 - y0 + 1; pop_w = x1 - x0 + 1;
        be_popup(pop_h, pop_w);
        delwin(pn[P_POP]);
        pn[P_POP] = newwin(pop_h, pop_w, 0, 0);
    }
    for (y = y0; y <= y1; y++)
        for (x = x0; x <= x1; x++) pset(pn[P_POP], y - y0, x - x0, w->c[y * w->maxx + x]);
    if (w->cury >= y0 && w->cury <= y1 && w->curx >= x0 && w->curx <= x1)
        be_cursor(P_POP, w->cury - y0, w->curx - x0);
    else be_cursor(-1, 0, 0);
}

static void dump(const char *name, WINDOW *p, int y0, int y1)
{
    FILE *f = fopen(getenv("XROGUE_DUMP"), "a");
    int y, x;
    if (!f) return;
    fprintf(f, "== %s\n", name);
    for (y = y0; p && y < y1; y++) {
        for (x = 0; x < p->maxx; x++) fputc(p->c[y * p->maxx + x] & A_CHARTEXT, f);
        fputc('\n', f);
    }
    fclose(f);
}

int wrefresh(WINDOW *w)
{
    extern WINDOW *msgw;
    int i;
    if (w == wc_mapwin) map_refresh(w);
    else if (w == msgw) msg_refresh(w);
    else pop_refresh(w);
    for (i = P_STATUS; i < NPANES; i++) if (i != P_POP || pop_h) pflush(i);
    be_flush();
    if (getenv("XROGUE_DUMP")) {        /* testing: panes as text */
        fclose(fopen(getenv("XROGUE_DUMP"), "w"));
        if (wc_mapwin) dump("MAP", wc_mapwin, 1, LINES - 2);
        for (i = P_STATUS; i < NPANES; i++)
            dump(i == P_STATUS ? "STATUS" : i == P_MSG ? "MSG" : i == P_INV ? "INV" : "POP",
                 i == P_POP && !pop_h ? NULL : pn[i], 0, pn[i] ? pn[i]->maxy : 0);
    }
    return OK;
}

static int pushback = -1;

int wgetch(WINDOW *w)
{
    int k = pushback;
    wrefresh(w);
    pushback = -1;
    return k >= 0 ? k : be_getkey(1);
}

/* A key is waiting (auto-explore stops on any key). */
int wc_kbhit(void)
{
    if (pushback < 0) pushback = be_getkey(0);
    return pushback >= 0;
}

int flushinp(void) { pushback = -1; while (be_getkey(0) >= 0) ; return OK; }

const char *unctrl(chtype c)
{
    static char buf[3];
    c &= A_CHARTEXT;
    if (c < ' ' || c == 127) { buf[0] = '^'; buf[1] = c == 127 ? '?' : c + '@'; buf[2] = 0; }
    else { buf[0] = c; buf[1] = 0; }
    return buf;
}

char erasechar(void) { return '\b'; }
char killchar(void) { return 21; }  /* ^U */
int wstandout(WINDOW *w) { attr = A_STANDOUT; return OK; }
int wstandend(WINDOW *w) { attr = 0; return OK; }

int wgetstr(WINDOW *w, char *s)
{
    int n = 0, c;
    for (;;) {
        c = wgetch(w);
        if (c == '\r' || c == '\n' || c == 27) break;
        if ((c == '\b' || c == 127) && n) {
            n--; w->curx--; waddch(w, ' '); w->curx--;
        } else if (c >= ' ' && c < 127 && n < 79) {
            s[n++] = c; waddch(w, c);
        }
    }
    s[n] = 0;
    return OK;
}

static int post_end;          /* text printed after endwin() */

int wc_printf(const char *f, ...)
{
    va_list ap; int r;
    va_start(ap, f);
    if (!curscr) { r = vprintf(f, ap); va_end(ap); return r; }
    if (ended && !post_end) { werase(stdscr); stdscr->clear = 1; post_end = 1; }
    r = vwprintw(stdscr, f, ap);
    va_end(ap);
    wrefresh(stdscr);
    return r;
}

void wc_exit(int n)
{
    if (curscr && post_end) {
        waddstr(stdscr, "\n\n[Press any key to exit]");
        wgetch(stdscr);
    }
    if (curscr) be_end();
    exit(n);
}
