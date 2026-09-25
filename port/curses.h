/* Minimal curses for XRogue: in-memory windows, drawn by a frontend
 * (be_x11.c on the Mac, be_web.c in the browser). Only what XRogue uses. */
#ifndef WCURSES_H
#define WCURSES_H
#include <stdarg.h>
#include <stdio.h>
#include <ctype.h>

typedef unsigned int chtype;
#if !defined(__cplusplus) && !defined(bool)
typedef char bool;
#endif
#ifndef TRUE
#define TRUE 1
#define FALSE 0
#endif
#define ERR (-1)
#define OK 0

#define A_CHARTEXT 0xff
#define A_STANDOUT 0x100
#define A_ALTCHARSET 0
#define wattron(w, a) OK
#define wattroff(w, a) OK

typedef struct _win {
    int maxy, maxx, begy, begx, cury, curx;
    int clear;          /* clearok */
    short *first, *last;/* changed range per line, -1 = none */
    chtype *c;
} WINDOW;

extern WINDOW *stdscr, *curscr;
extern int LINES, COLS;

#define KEY_DOWN  0402
#define KEY_UP    0403
#define KEY_LEFT  0404
#define KEY_RIGHT 0405
#define KEY_HOME  0406
#define KEY_BACKSPACE 0407
#define KEY_NPAGE 0522
#define KEY_PPAGE 0523
#define KEY_A1    0534
#define KEY_A3    0535
#define KEY_B2    0536
#define KEY_C1    0537
#define KEY_C3    0540
#define KEY_END   0550

WINDOW *initscr(void);
int endwin(void);
int isendwin(void);
WINDOW *newwin(int, int, int, int);
int delwin(WINDOW *);
int wmove(WINDOW *, int, int);
int waddch(WINDOW *, chtype);
int waddstr(WINDOW *, const char *);
int wprintw(WINDOW *, const char *, ...);
int vwprintw(WINDOW *, const char *, va_list);
int printw(const char *, ...);
int mvprintw(int, int, const char *, ...);
int mvwprintw(WINDOW *, int, int, const char *, ...);
chtype winch(WINDOW *);
int wclear(WINDOW *);
int werase(WINDOW *);
int wclrtoeol(WINDOW *);
int wclrtobot(WINDOW *);
int touchwin(WINDOW *);
int overlay(WINDOW *, WINDOW *);
int overwrite(WINDOW *, WINDOW *);
int wrefresh(WINDOW *);
int wgetch(WINDOW *);
int clearok(WINDOW *, int);
int flushinp(void);
int wc_kbhit(void);
const char *unctrl(chtype);
char erasechar(void);
char killchar(void);
int wstandout(WINDOW *);
int wstandend(WINDOW *);

#define getmaxx(w) ((w)->maxx)
#define getmaxy(w) ((w)->maxy)
#define getyx(w, y, x) ((y) = (w)->cury, (x) = (w)->curx)
#define mvwinch(w, y, x) (wmove(w, y, x) == ERR ? (chtype)ERR : winch(w))
#define mvwaddch(w, y, x, ch) (wmove(w, y, x) == ERR ? ERR : waddch(w, ch))
#define mvwaddstr(w, y, x, s) (wmove(w, y, x) == ERR ? ERR : waddstr(w, s))
#define move(y, x) wmove(stdscr, y, x)
#define addch(ch) waddch(stdscr, ch)
#define addstr(s) waddstr(stdscr, s)
#define inch() winch(stdscr)
#define mvinch(y, x) mvwinch(stdscr, y, x)
#define mvaddch(y, x, ch) mvwaddch(stdscr, y, x, ch)
#define mvaddstr(y, x, s) mvwaddstr(stdscr, y, x, s)
#define clear() wclear(stdscr)
#define erase() werase(stdscr)
#define clrtoeol() wclrtoeol(stdscr)
#define refresh() wrefresh(stdscr)
#define getch() wgetch(stdscr)
#define standout() wstandout(stdscr)
#define standend() wstandend(stdscr)
#define keypad(w, b) OK
#define typeahead(fd) OK
#define noecho() OK
#define echo() OK
#define cbreak() OK
#define crmode() OK
#define mvcur(a, b, c, d) OK
#define nocbreak() OK
#define raw() OK
#define noraw() OK
#define nonl() OK
#define nl() OK
#define savetty() OK
#define resetty() OK

int wgetstr(WINDOW *, char *);
#define getstr(s) wgetstr(stdscr, s)
/* The score list is printf()ed after endwin(): show it in the window and
 * wait for a key before the program (and its window) goes away. */
int wc_printf(const char *, ...);
void wc_exit(int);
#ifndef WCURSES_IMPL
#define printf wc_printf
#define exit(n) wc_exit(n)
#endif

/* frontend interface: panes, Angband-style subwindows. Only the map is
 * tiled; text goes to text panes and a pop-up box sized to its content. */
enum { P_MAP, P_STATUS, P_MSG, P_INV, P_POP, NPANES };
void be_init(int pane, int cols, int rows);
void be_put(int pane, int y, int x, chtype ch, int tile, int under);
void be_cursor(int pane, int y, int x);   /* pane -1: no cursor */
void be_popup(int rows, int cols);        /* 0: close */
void be_flush(void);
int  be_getkey(int wait);   /* -1 when !wait and nothing queued */
void be_end(void);
int  tile_for(int y, int x, int ch, int *under);  /* tiles.c: -1 = text */
void wc_inv(WINDOW *);                            /* tiles.c */
extern WINDOW *wc_mapwin;  /* the game's map window (cw) */
extern int wc_cmd_prompt;  /* waiting for a command key */
extern int wc_saved;       /* the player saved (S): keep the save file */
void be_sound(const char *);    /* game event, Dubtrain sound name (web plays it) */
#define XR_SHIM 1
#endif
