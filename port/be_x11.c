/* X11 frontend for the curses shim: one window per pane (Angband-style
 * subwindows) plus an undecorated pop-up over the map. Only the map is
 * tiled (NetHack tiles, square cells, nearest-neighbour, RVIP step 4);
 * text panes use a normal font.
 * Env: XROGUE_CELL (map cell, default 18), XROGUE_TILES (tiles.rgba),
 * XROGUE_XFT (font family, default Menlo), XROGUE_TEXT (text px, 14),
 * XROGUE_MAP / _STATUS / _MSG / _INV = "x,y" window positions. */
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/keysym.h>
#include <X11/Xft/Xft.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "curses.h"

static Display *dpy;
static int scr;
static Visual *vis;
static Colormap cmap;
static GC gc;
static XftFont *mapfont, *txtfont;
static XftColor xfg, xbg;
static unsigned long fg, bg;
static int cell = 18, tw, th, curP = -1, curY, curX;
static unsigned char *sheet;     /* RGBA */
static int sheet_w, sheet_h;
static XImage *img;               /* one map cell, reused */
static unsigned char *istext;     /* map cells drawn as text (cursor style) */

static struct pane {
    Window win;
    Pixmap pix;
    XftDraw *xd;
    int cols, rows, cw, ch, pad;
} P[NPANES];

static const char *pname[NPANES] = { "MAP", "STATUS", "MSG", "INV", "POP" };
static const char *ptitle[NPANES] = { "XRogue", "XRogue Status", "XRogue Messages", "XRogue Inventory", "" };

static unsigned long rgb(int r, int g, int b)
{
    XColor c;
    c.red = r * 257; c.green = g * 257; c.blue = b * 257;
    XAllocColor(dpy, cmap, &c);
    return c.pixel;
}

static void load_sheet(void)
{
    const char *p = getenv("XROGUE_TILES");
    FILE *f = fopen(p ? p : "port/tiles.rgba", "rb");
    unsigned char h[8];
    if (!f || fread(h, 1, 8, f) != 8) { if (f) fclose(f); return; }
    sheet_w = h[0] | h[1] << 8 | h[2] << 16 | h[3] << 24;
    sheet_h = h[4] | h[5] << 8 | h[6] << 16 | h[7] << 24;
    sheet = malloc((size_t)sheet_w * sheet_h * 4);
    if (fread(sheet, 4, (size_t)sheet_w * sheet_h, f) != (size_t)sheet_w * sheet_h) {
        free(sheet); sheet = NULL;
    }
    fclose(f);
}

static XftFont *font(double px, double stretch, int weight)
{
    const char *fam = getenv("XROGUE_XFT");
    FcMatrix m;
    FcMatrixInit(&m);
    m.xx = stretch;
    return XftFontOpen(dpy, scr, XFT_FAMILY, XftTypeString, fam ? fam : "Menlo",
                       XFT_WEIGHT, XftTypeInteger, weight,
                       XFT_PIXEL_SIZE, XftTypeDouble, px, XFT_MATRIX, XftTypeMatrix, &m, NULL);
}

static void open_display(void)
{
    XGlyphInfo gi;
    XRenderColor c1 = { 0xdcdc, 0xdcdc, 0xdcdc, 0xffff }, c0 = { 0, 0, 0, 0xffff };
    const char *e;
    double px;

    if (!(dpy = XOpenDisplay(NULL))) { fprintf(stderr, "xrogue: no X display\n"); exit(1); }
    scr = DefaultScreen(dpy);
    vis = DefaultVisual(dpy, scr);
    cmap = DefaultColormap(dpy, scr);
    if ((e = getenv("XROGUE_CELL"))) cell = atoi(e);
    fg = rgb(215, 215, 215); bg = rgb(0, 0, 0);
    gc = XCreateGC(dpy, DefaultRootWindow(dpy), 0, NULL);
    /* map text (the start level's help): stretched to fill the square cell */
    mapfont = font(cell * 0.78, 1, XFT_WEIGHT_BOLD);
    XftTextExtents8(dpy, mapfont, (FcChar8 *)"M", 1, &gi);
    mapfont = font(cell * 0.78, (cell * 0.92) / (gi.xOff > 0 ? gi.xOff : 1), XFT_WEIGHT_BOLD);
    px = (e = getenv("XROGUE_TEXT")) ? atof(e) : 14;
    txtfont = font(px, 1, XFT_WEIGHT_MEDIUM);
    XftTextExtents8(dpy, txtfont, (FcChar8 *)"M", 1, &gi);
    tw = gi.xOff; th = txtfont->ascent + txtfont->descent;
    XftColorAllocValue(dpy, vis, cmap, &c1, &xfg);
    XftColorAllocValue(dpy, vis, cmap, &c0, &xbg);
    img = XCreateImage(dpy, vis, DefaultDepth(dpy, scr), ZPixmap, 0, malloc(cell * cell * 4),
                       cell, cell, 32, 0);
    load_sheet();
}

/* Default layout for a 1440x932 screen: map on top, messages and status
 * below on the left, inventory on the right. XQuartz adds title bars. */
static void place(int p, int *x, int *y)
{
    char var[32];
    const char *e;
    int below = P[P_MAP].rows * cell + 2;    /* XQuartz adds a 22 px title bar */
    *x = p == P_INV ? DisplayWidth(dpy, scr) / 2 + 6 : 0;
    *y = p == P_MAP ? 0 : p == P_STATUS ? below + P[P_MSG].rows * th + 24 : below;
    snprintf(var, sizeof var, "XROGUE_%s", pname[p]);
    if ((e = getenv(var))) sscanf(e, "%d,%d", x, y);
}

static void make_pixmap(struct pane *q)
{
    int w = q->cols * q->cw + 2 * q->pad, h = q->rows * q->ch + 2 * q->pad;
    if (q->xd) XftDrawDestroy(q->xd);
    if (q->pix) XFreePixmap(dpy, q->pix);
    q->pix = XCreatePixmap(dpy, q->win, w, h, DefaultDepth(dpy, scr));
    q->xd = XftDrawCreate(dpy, q->pix, vis, cmap);
    XSetForeground(dpy, gc, bg);
    XFillRectangle(dpy, q->pix, gc, 0, 0, w, h);
}

void be_init(int p, int cols, int rows)
{
    struct pane *q = &P[p];
    XSizeHints h;
    int x, y;

    if (!dpy) open_display();
    q->cols = cols; q->rows = rows;
    q->cw = p == P_MAP ? cell : tw;
    q->ch = p == P_MAP ? cell : th;
    if (p == P_MAP) istext = calloc(cols * rows, 1);
    place(p, &x, &y);
    q->win = XCreateSimpleWindow(dpy, DefaultRootWindow(dpy), x, y, cols * q->cw, rows * q->ch, 0, fg, bg);
    h.flags = PPosition | USPosition | PMinSize | PMaxSize;
    h.x = x; h.y = y;
    h.min_width = h.max_width = cols * q->cw;
    h.min_height = h.max_height = rows * q->ch;
    XSetWMNormalHints(dpy, q->win, &h);
    XStoreName(dpy, q->win, ptitle[p]);
    XSelectInput(dpy, q->win, KeyPressMask | ExposureMask);
    make_pixmap(q);
    XMapWindow(dpy, q->win);
    XFlush(dpy);
}

/* The pop-up: no title bar, over the top left of the map, sized to its
 * content plus one character of padding. */
void be_popup(int rows, int cols)
{
    struct pane *q = &P[P_POP];
    int x, y, w, h;
    Window child;

    if (!rows) { if (q->win) XUnmapWindow(dpy, q->win); return; }
    q->cw = tw; q->ch = th; q->pad = tw;
    q->cols = cols; q->rows = rows;
    w = cols * tw + 2 * q->pad; h = rows * th + 2 * q->pad;
    XTranslateCoordinates(dpy, P[P_MAP].win, DefaultRootWindow(dpy), cell, 0, &x, &y, &child);
    if (!q->win) {
        XSetWindowAttributes a;
        a.override_redirect = True;
        a.background_pixel = bg;
        a.border_pixel = fg;
        q->win = XCreateWindow(dpy, DefaultRootWindow(dpy), x, y, w, h, 1, CopyFromParent,
                               InputOutput, CopyFromParent, CWOverrideRedirect | CWBackPixel | CWBorderPixel, &a);
        XSelectInput(dpy, q->win, KeyPressMask | ExposureMask);
    } else XMoveResizeWindow(dpy, q->win, x, y, w, h);
    make_pixmap(q);
    XMapRaised(dpy, q->win);
}

static void draw_text(struct pane *q, int y, int x, chtype ch)
{
    FcChar8 c = ch & A_CHARTEXT;
    XftFont *f = q == &P[P_MAP] ? mapfont : txtfont;
    int inv = !!(ch & A_STANDOUT), px = q->pad + x * q->cw, py = q->pad + y * q->ch;
    XGlyphInfo gi;
    XSetForeground(dpy, gc, inv ? fg : bg);
    XFillRectangle(dpy, q->pix, gc, px, py, q->cw, q->ch);
    if (c == ' ') return;
    XftTextExtents8(dpy, f, &c, 1, &gi);
    XftDrawString8(q->xd, inv ? &xbg : &xfg, f, px + (q->cw - gi.xOff) / 2,
                   py + (q->ch - f->ascent - f->descent) / 2 + f->ascent, &c, 1);
}

static void blend(int t, int first)
{
    int px, py, tx = (t % 32) * 16, ty = (t / 32) * 16;
    for (py = 0; py < cell; py++)
        for (px = 0; px < cell; px++) {
            /* nearest-neighbour */
            unsigned char *s = sheet + ((ty + py * 16 / cell) * sheet_w + tx + px * 16 / cell) * 4;
            unsigned long o = XGetPixel(img, px, py);
            int a = s[3];
            int r = (o >> 16) & 255, g = (o >> 8) & 255, b = o & 255;
            if (first) r = g = b = 0;
            r = (s[0] * a + r * (255 - a)) / 255;
            g = (s[1] * a + g * (255 - a)) / 255;
            b = (s[2] * a + b * (255 - a)) / 255;
            XPutPixel(img, px, py, (unsigned long)r << 16 | g << 8 | b);
        }
}

void be_put(int p, int y, int x, chtype ch, int tile, int under)
{
    struct pane *q = &P[p];
    if (!q->pix || y < 0 || x < 0 || y >= q->rows || x >= q->cols) return;
    if (p == P_MAP) istext[y * q->cols + x] = tile < 0;
    if (tile < 0 || !sheet || (tile / 32 + 1) * 16 > sheet_h) {
        draw_text(q, y, x, ch);
        return;
    }
    blend(under >= 0 ? under : tile, 1);
    if (under >= 0) blend(tile, 0);
    XPutImage(dpy, q->pix, gc, img, 0, 0, x * cell, y * cell, cell, cell);
}

void be_cursor(int p, int y, int x) { curP = p; curY = y; curX = x; }

void be_flush(void)
{
    int p;
    for (p = 0; p < NPANES; p++) {
        struct pane *q = &P[p];
        if (q->win && q->pix)
            XCopyArea(dpy, q->pix, q->win, gc, 0, 0, q->cols * q->cw + 2 * q->pad,
                      q->rows * q->ch + 2 * q->pad, 0, 0);
    }
    /* cursor: a bar under text, an outline around tiles */
    if (curP >= 0 && P[curP].win && curY < P[curP].rows && curX < P[curP].cols) {
        struct pane *q = &P[curP];
        int px = q->pad + curX * q->cw, py = q->pad + curY * q->ch;
        XSetForeground(dpy, gc, fg);
        if (curP != P_MAP || istext[curY * q->cols + curX])
            XFillRectangle(dpy, q->win, gc, px, py + q->ch - 2, q->cw, 2);
        else
            XDrawRectangle(dpy, q->win, gc, px, py, q->cw - 1, q->ch - 1);
    }
    XFlush(dpy);
}

static int keycode(XKeyEvent *ev)
{
    char buf[8];
    KeySym ks;
    int n = XLookupString(ev, buf, sizeof buf, &ks, NULL);
    switch (ks) {
    case XK_Left: case XK_KP_Left: case XK_KP_4: return KEY_LEFT;
    case XK_Right: case XK_KP_Right: case XK_KP_6: return KEY_RIGHT;
    case XK_Up: case XK_KP_Up: case XK_KP_8: return KEY_UP;
    case XK_Down: case XK_KP_Down: case XK_KP_2: return KEY_DOWN;
    case XK_Home: case XK_KP_Home: case XK_KP_7: return KEY_A1;
    case XK_Prior: case XK_KP_Prior: case XK_KP_9: return KEY_A3;
    case XK_End: case XK_KP_End: case XK_KP_1: return KEY_C1;
    case XK_Next: case XK_KP_Next: case XK_KP_3: return KEY_C3;
    case XK_KP_Begin: case XK_KP_5: return KEY_B2;
    case XK_KP_Enter: case XK_Return: return '\r';
    case XK_BackSpace: case XK_Delete: return '\b';
    case XK_KP_Add: return '+';
    case XK_KP_Subtract: return '-';
    case XK_KP_Multiply: return '*';
    case XK_KP_Divide: return '/';
    case XK_KP_Decimal: case XK_KP_Delete: return '.';
    case XK_KP_0: case XK_KP_Insert: return '0';
    }
    return n == 1 ? (unsigned char)buf[0] : -1;
}

int be_getkey(int wait)
{
    XEvent ev;
    for (;;) {
        if (!wait && !XPending(dpy)) return -1;
        XNextEvent(dpy, &ev);
        if (ev.type == Expose) be_flush();
        else if (ev.type == KeyPress) {
            int k = keycode(&ev.xkey);
            if (getenv("XROGUE_KEYLOG")) fprintf(stderr, "key %d\n", k);
            if (k >= 0) return k;
        }
    }
}

void be_sound(const char *s) { }

void be_end(void) { if (dpy) XCloseDisplay(dpy); dpy = NULL; }
void be_invfg(int y, const char *css) { }

void be_prompt(const char *s) { }   /* web only: the prompt line over the map */
