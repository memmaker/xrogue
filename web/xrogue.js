/*
 * XRogue in the browser: draws the panes of the curses shim (port/be_web.c
 * calls Module.xr), keyboard input, tiling windows, sound, saves in
 * IndexedDB. Loaded before xrogue-core.js.
 */
(function () {
	'use strict';

	var P_MAP = 0, P_STATUS = 1, P_MSG = 2, P_INV = 3, P_POP = 4;
	var WIN = ['map', 'stat', 'msg', 'inv'];          /* pane -> window id */
	var DIR = '/xrogue/save';                         /* IDBFS mount: saves, scores, layout */
	var SAVE = DIR + '/xrogue.sav', LAYOUT_FILE = DIR + '/web-layout.json';
	var FONT = '"DejaVu Sans Mono", Menlo, Consolas, "Liberation Mono", monospace';
	var FG = '#dcdcdc', BG = '#000';
	var GUT = 6, TITLE_H = 20, BORDER = 2;
	var TILE_STEPS = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96];
	/* curses key codes (port/curses.h) */
	var KEY = { ArrowDown: 258, ArrowUp: 259, ArrowLeft: 260, ArrowRight: 261,
		Home: 348, PageUp: 349, End: 351, PageDown: 352 };
	var NUMPAD = { 1: 351, 2: 258, 3: 352, 4: 260, 5: 350, 6: 261, 7: 348, 8: 259, 9: 349 };

	var panes = [];            /* {cv, ctx, cols, rows, cw, ch, pad, buf} */
	var events = [];
	var tiles = new Image(), tilesReady = false;
	var saveReq = false, app;
	var cur = { p: -1, y: 0, x: 0 };
	var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
	var L = null, rects = {};

	function $(id) { return document.getElementById(id); }
	function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
	function status(msg, isError) { app.status(msg, isError); }

	/* ---------- panes ---------- */

	/* top-bar font: the text windows; the map (text mode) has its own */
	function face(p) { var n = L && (p === P_MAP ? L.mapFace : L.face); return n ? '"' + n + '", ' + FONT : FONT; }

	/* Map cell size from the zoom; rebuilds the canvas and redraws */
	function shape(p) {
		var T = panes[p];
		T.cw = T.ch = L.tile;
		T.font = (L.mapFace ? '' : 'bold ') + Math.round(T.ch * 0.8) + 'px ' + face(p);
		var w = T.cols * T.cw, h = T.rows * T.ch;
		T.cv.width = Math.round(w * dpr); T.cv.height = Math.round(h * dpr);
		T.w = w; T.h = h;
		T.ctx = T.cv.getContext('2d');
		T.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		T.ctx.imageSmoothingEnabled = false;                 /* nearest-neighbour tiles */
		T.ctx.fillStyle = BG; T.ctx.fillRect(0, 0, w, h);
		for (var i = 0; i < T.cols * T.rows; i++) draw(p, (i / T.cols) | 0, i % T.cols);
		fit(p);
	}

	/* ---------- text windows (RVIP W0 rule 6): HTML lines from the game ----------
	 * The game sends each changed row trimmed (standout between \x01 and \x02),
	 * its colour and icon tile, and the rows in use; the WM sets the text size. */
	var txt = [];              /* pane -> {el, lines, css, tile, n} */
	function textPane(p) {
		var el = p === P_POP ? $('pop').firstElementChild : document.querySelector('#t-' + WIN[p] + ' .body' + (p === P_INV ? '' : ' pre'));
		el.textContent = '';
		txt[p] = { el: el, lines: [], css: [], tile: [], n: 0 };
	}
	function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
	function rowHtml(p, y) {
		var T = txt[p], s = T.lines[y] || '', cx = cur.p === p && cur.y === y ? cur.x : -1;
		if (cx >= 0) {                              /* the cursor: one cell, past the end if need be */
			var vis = s.replace(/[\x01\x02]/g, '');
			while (vis.length <= cx) { s += ' '; vis += ' '; }
			for (var i = 0, k = 0; i < s.length; i++) if (s[i] > '\x02' && k++ === cx) break;
			s = s.slice(0, i) + '\x03' + s[i] + '\x04' + s.slice(i + 1);
		}
		return esc(s).replace(/\x01/g, '<span class="so">').replace(/[\x02\x04]/g, '</span>').replace(/\x03/g, '<span class="cur">');
	}
	function drawRow(p, y) {
		var T = txt[p], d = T && T.el.children[y];
		if (!d) return;
		d.innerHTML = rowHtml(p, y);
		d.style.color = T.css[y] || '';
		if (p === P_INV) { var ic = visIcon(T.tile[y]); if (ic) d.insertBefore(ic, d.firstChild); }
	}
	function setRows(p, n) {
		var T = txt[p];
		while (T.el.children.length < n) { T.el.appendChild(document.createElement('div')); drawRow(p, T.el.children.length - 1); }
		while (T.el.children.length > n) T.el.removeChild(T.el.lastChild);
		T.n = n;
	}
	function msgMark() {                          /* before a Messages change: was it at the end? */
		var b = txt[P_MSG] && txt[P_MSG].el.parentNode;
		if (b && xr.follow == null) xr.follow = b.scrollTop + b.clientHeight >= b.scrollHeight - 4;
	}
	function popFont() { $('pop').style.fontSize = RvipWM.fontSize('msg') + 'px'; placePop(); }
	function placePop() { if (!$('pop').hidden && rects.map) RvipWM.popup($('pop'), { x: L.tile }); }

	function makePane(p, cols, rows) {
		var n = cols * rows;
		panes[p] = { cv: document.querySelector('#t-map canvas'), cols: cols, rows: rows, ch_: new Int32Array(n).fill(32),
			t: new Int32Array(n).fill(-1), u: new Int32Array(n).fill(-1) };
		shape(p);
	}

	function draw(p, y, x) {
		var T = panes[p], c = T.ctx, i = y * T.cols + x;
		var ch = T.ch_[i], t = T.t[i], u = T.u[i];
		var px = x * T.cw, py = y * T.ch;
		var inv = !!(ch & 0x100);
		c.fillStyle = inv ? FG : BG;
		c.fillRect(px, py, T.cw, T.ch);
		if (t >= 0 && tilesReady) {
			var im = p === P_MAP && frame && tiles1.naturalWidth ? tiles1 : tiles;   /* DawnLike's 2nd frame */
			if (u >= 0) c.drawImage(im, (u % 32) * 16, ((u / 32) | 0) * 16, 16, 16, px, py, T.cw, T.ch);
			c.drawImage(im, (t % 32) * 16, ((t / 32) | 0) * 16, 16, 16, px, py, T.cw, T.ch);
			return;
		}
		var k = ch & 0xff;
		if (k > 32) {
			c.font = T.font;
			c.textAlign = 'center'; c.textBaseline = 'middle';
			c.fillStyle = inv ? BG : FG;
			c.fillText(String.fromCharCode(k), px + T.cw / 2, py + T.ch / 2 + 1);
		}
	}

	function drawCursor() {
		var T = panes[cur.p];
		if (cur.p !== P_MAP || !T || cur.y >= T.rows || cur.x >= T.cols) return;
		if (cur.y === hero.y && cur.x === hero.x) return;   /* the hero is marker enough */
		var c = T.ctx, px = cur.x * T.cw, py = cur.y * T.ch;
		c.fillStyle = c.strokeStyle = FG;
		if (tilesReady && T.t[cur.y * T.cols + cur.x] >= 0) { c.lineWidth = 1; c.strokeRect(px + 0.5, py + 0.5, T.cw - 1, T.ch - 1); }
		else c.fillRect(px, py + T.ch - 2, T.cw, 2);
	}

	/* ---------- tiling layout ---------- */
	/*
	 *   +---------------------------+   bottom: y of map | lower part
	 *   |            map            |   side:   x of left | inventory
	 *   +-------------+-------------+   stat:   y of messages | status
	 *   |  messages   |             |           (fraction of the lower part)
	 *   +-------------+  inventory  |
	 *   |  status     |             |
	 *   +-------------+-------------+
	 */
	var SPLITS = ['bottom', 'side', 'stat'];

	function areaSize() {
		var g = $('game');
		return { w: g.clientWidth, h: g.clientHeight };
	}

	function defaultLayout() {
		var A = areaSize(), W = A.w, H = A.h;
		if (W < 400 || H < 300) { W = 1280; H = 720; }
		var font = RvipWM.fontSize('stat'), tile = TILE_STEPS[0];
		TILE_STEPS.forEach(function (t) { if (80 * t + BORDER <= W && 21 * t + BORDER <= H * 0.6) tile = t; });
		var mapH = 21 * tile + BORDER, lower = H - mapH - GUT;
		var statH = TITLE_H + BORDER + 2 * Math.round(font * 1.3) + 4;
		return { v: 1, tile: tile, auto: true,
			split: { bottom: (mapH + GUT / 2) / H, side: 0.5, stat: clamp((lower - statH - GUT / 2) / lower, 0.3, 0.95) },
			audio: { sound: false } };
	}

	function loadLayout() {
		var d = defaultLayout();
		try {
			var s = JSON.parse(Module.FS.readFile(LAYOUT_FILE, { encoding: 'utf8' }));
			if (s && s.v === 1) {
				if (!s.auto) {
					d.auto = false;
					SPLITS.forEach(function (k) { if (s.split[k] > 0 && s.split[k] < 1) d.split[k] = s.split[k]; });
					if (TILE_STEPS.indexOf(s.tile) >= 0) d.tile = s.tile;
				}
				if (s.wm) d.wm = s.wm;
				if (s.font && d.wm && !d.wm.fs) d.wm.fs = s.font;   /* old layout: sizes were L.font */
				if (typeof s.face === 'string') d.face = s.face;
				if (typeof s.mapFace === 'string') d.mapFace = s.mapFace;
				if (typeof s.name === 'string') d.name = s.name;     /* the player's name (asked once) */
				if (typeof s.tiles === 'string') d.tiles = s.tiles;  /* the tile set, by name */
				if (s.audio) d.audio = { sound: s.audio.sound === true };
			}
		} catch (err) { /* nothing saved yet */ }
		L = d;
		renderAudio();
		$('sel-font').value = L.face || '';   /* if fonts.json came first */
		loadFace(L.face); loadFace(L.mapFace);
	}

	var saveTimer = 0;
	function saveLayout() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(function () {
			try { Module.FS.writeFile(LAYOUT_FILE, JSON.stringify(L)); app.sync(); }
			catch (err) { console.warn('layout not saved', err); }
		}, 400);
	}

	function place(el, r) {
		el.style.left = r[0] + 'px'; el.style.top = r[1] + 'px';
		el.style.width = Math.max(0, r[2]) + 'px'; el.style.height = Math.max(0, r[3]) + 'px';
	}

	/* the map never shrinks: bigger than its window, it scrolls with the hero */
	function fit(p) {
		var T = panes[p], r = rects.map;
		if (!T || !r) return;
		T.box = { w: r[2] - BORDER, h: r[3] - BORDER - ($('game').classList.contains('wm-single') ? 0 : TITLE_H) };
		scrollMap(true);
	}

	var hero = { y: 0, x: 0 }, off = { x: 0, y: 0 };
	/* Keep the hero in the middle half of the map window; recentre when it
	 * leaves it (or always, after a zoom, resize or new level) */
	function scrollMap() {
		var T = panes[P_MAP];
		if (!T || !T.box) return;
		T.cv.style.width = T.w + 'px'; T.cv.style.height = T.h + 'px';
		off = RvipWM.center(T.cv, (hero.x + 0.5) * T.cw, (hero.y + 0.5) * T.ch, T.w, T.h, T.box.w, T.box.h);
	}

	var wm = null;
	function applyDom() { if (wm) wm.apply(); }
	function makeWM() {
		var s = defaultLayout().split, A = areaSize();
		var line = Math.round(RvipWM.fontSize('msg') * 1.3) + 4, stat = Math.round(RvipWM.fontSize('stat') * 1.3) + 4;
		wm = RvipWM({
			area: $('game'), menu: $('btn-layout'),
			wins: [{ id: 'map', title: 'Map' }, { id: 'msg', title: 'Messages' }, { id: 'stat', title: 'Status' }, { id: 'inv', title: 'Inventory' }, { id: 'vis', title: 'Visible' }],
			multi: { d: 'v', r: s.bottom, a: 'map', b: { d: 'h', r: 0.4, a: { d: 'v', r: s.stat, a: 'msg', b: 'stat' }, b: { d: 'h', r: 0.5, a: 'inv', b: 'vis' } } },
			single: { d: 'v', r: line / A.h, a: 'msg', b: { d: 'v', r: 1 - stat / (A.h - line), a: 'map', b: 'stat' } },
			state: L.wm,
			save: function (st) { L.wm = st; saveLayout(); },
			layout: function (r) { rects = r; fit(P_MAP); placePop(); var mb = txt[P_MSG] && txt[P_MSG].el.parentNode; if (mb) mb.scrollTop = mb.scrollHeight; },
			/* A- / A+: the map steps its tiles; the text windows are the WM's; the pop-up follows Messages */
			zoom: { map: function (s, d) { zoomMap(d); }, msg: popFont },
			onReset: resetLayout
		});
		wm.apply();
		renderMapSel();
	}

	function zoomMap(d) {
		var i = clamp(TILE_STEPS.indexOf(L.tile) + d, 0, TILE_STEPS.length - 1);
		L.tile = TILE_STEPS[i]; L.auto = false;
		shape(P_MAP); applyDom(); saveLayout();
		status('Map tiles: ' + L.tile + ' px');
		setTimeout(function () { status(''); }, 1200);
	}

	function resetLayout() {
		var a = L.audio, fc = L.face, mf = L.mapFace, nm = L.name, ts = L.tiles;
		L = defaultLayout(); L.audio = a; L.face = fc; L.mapFace = mf; L.name = nm; L.tiles = ts; L.wm = wm.state();
		shape(P_MAP); popFont();
		applyDom(); saveLayout();
	}

	/* ---------- sound ---------- */
	/* sound events come from the game (be_sound() calls in the sources); the
	 * samples are synthesized for this game at build time (web/mksounds.py) */
	var audio = { cfg: null, cache: {}, level: -1 };

	function play(name) {
		var files = L && L.audio.sound && audio.cfg[name];
		if (!files || !files.length) return;
		var f = files[Math.floor(Math.random() * files.length)];
		if (!audio.cache[f]) audio.cache[f] = new Audio('sound/' + f);
		var a = audio.cache[f].cloneNode();
		a.volume = 0.6;
		a.play().catch(function () { });
	}
	function toggleAudio(k) {
		L.audio[k] = !L.audio[k];
		renderAudio(); saveLayout();
	}
	function renderAudio() {
		var a = L ? L.audio : { sound: false };
		$('chk-sound').checked = a.sound;
		if (a.sound && !audio.cfg) {   /* sounds.json only once effects are on */
			audio.cfg = {};
			fetch('sound/sounds.json').then(function (r) { return r.json(); }).then(function (c) { audio.cfg = c; }).catch(function () { });
		}
	}

	/* ---------- called by the game (port/be_web.c) ---------- */
	var xr = {
		init: function (p, cols, rows) {
			if (!L) loadLayout();
			if (p === P_MAP) makePane(p, cols, rows); else textPane(p);
			if (p === P_INV) { $('game').hidden = false; makeWM(); applyFace(); popFont(); }
		},
		put: function (p, y, x, ch, t, u) {
			var T = panes[p];
			if (!T || y < 0 || x < 0 || y >= T.rows || x >= T.cols) return;
			var i = y * T.cols + x;
			T.ch_[i] = ch; T.t[i] = t; T.u[i] = u;
			draw(p, y, x);
		},
		cursor: function (p, y, x) {
			var o = cur.p, oy = cur.y;
			cur.p = p; cur.y = y; cur.x = x;
			if (txt[o]) drawRow(o, oy);
			if (txt[p]) drawRow(p, y);
		},
		line: function (p, y, s, c, t) {
			var T = txt[p];
			if (!T) return;
			if (p === P_MSG) msgMark();
			T.lines[y] = s; T.css[y] = c; T.tile[y] = t;
			if (y < T.n) drawRow(p, y);
		},
		rows: function (p, n) { if (!txt[p]) return; if (p === P_MSG) msgMark(); setRows(p, n); },
		popup: function (rows, cols) {
			if (!rows) { $('pop').hidden = true; if (cur.p === P_POP) cur.p = -1; return; }
			textPane(P_POP);
			$('pop').hidden = false;
		},
		flush: function (level, town, hy, hx) {
			var mb = txt[P_MSG] && txt[P_MSG].el.parentNode;   /* follow the newest message unless scrolled up */
			if (mb && xr.follow) mb.scrollTop = mb.scrollHeight;
			xr.follow = null;
			placePop();
			if (hy !== hero.y || hx !== hero.x) { hero.y = hy; hero.x = hx; scrollMap(level !== audio.level); }
			/* the cursor is drawn over the cell; redraw that cell next time */
			if (xr.lastCur && panes[xr.lastCur.p]) draw(xr.lastCur.p, xr.lastCur.y, xr.lastCur.x);
			drawCursor();
			xr.lastCur = cur.p >= 0 ? { p: cur.p, y: cur.y, x: cur.x } : null;
			audio.level = level;
		},
		icons: function () { return tilesReady ? 1 : 0; },
		vis: function (s) { RvipWM.visible(document.querySelector('#t-vis .body'), s, visIcon); },
		key: function (atCmd) { RvipWM.prompt.wait(atCmd); xr.atCmd = atCmd; return events.length ? events.shift() : -1; },
		prompt: function (s) { RvipWM.prompt.text(s); },
		requestSave: function () { saveReq = true; },   /* also for testing */
		wantSave: function () {
			if (!saveReq || !app.running) return 0;
			saveReq = false;
			setTimeout(app.sync, 0);           /* after the game wrote the file */
			return 1;
		},
		sound: function (name) { play(name); },
		end: function (saved, dead) {
			app.running = false;
			app.sync(function () {
				$('overlay-msg').textContent = saved ? 'Your game has been saved. Play again to continue it.'
					: dead ? 'Your character died. The game is over.' : 'The game is over.';
				$('overlay').hidden = false;
			});
		}
	};

	/* ---------- input ---------- */
	function onKey(e) {
		if (!app.running || e.isComposing || e.metaKey) return;
		var k = e.key, code = e.code || '', m = /^Numpad(\d)$/.exec(code), c;
		if (m) c = +m[1] ? NUMPAD[m[1]] : 48;
		else if (code === 'NumpadEnter' || k === 'Enter') c = 13;
		else if (code === 'NumpadDecimal') c = 46;
		else if (k === 'Escape') c = 27;
		else if (k === 'Backspace' || k === 'Delete') c = 8;
		else if (k === 'Tab') c = 9;
		else if (KEY[k]) c = KEY[k];
		else if (k.length === 1) {
			c = k.charCodeAt(0);
			if (e.ctrlKey && !e.altKey) {
				var u = k.toUpperCase().charCodeAt(0);
				if (u >= 64 && u <= 95) c = u & 0x1F;
			}
			if (c > 255) return;
		}
		else return;
		events.push(c);
		e.preventDefault();
	}

	/* ---------- saves: IndexedDB (IDBFS), help, crashes: ../rvip-app.js ---------- */
	function hasSave() { try { Module.FS.stat(SAVE); return true; } catch (e) { return false; } }
	app = RvipApp({
		name: 'xrogue',
		save: function () { return hasSave() ? SAVE : null; },
		clear: function () { if (hasSave()) Module.FS.unlink(SAVE); },
		put: function (file, data) { Module.FS.writeFile(SAVE, data); },
		flush: function (done) { saveReq = true; setTimeout(done, 1500); },   /* the game saves at its next key wait */
		helpText: 'Press ? in the game for its own help.'
	});

	/* ---------- startup ---------- */
	var tilesDone = false, tilesWait = false;
	window.Module = {
		xr: xr,
		preRun: [function () {
			var FS = Module.FS;
			Module.addRunDependency('tiles'); tilesWait = true;   /* the sheet loads once the layout says which */
			FS.mkdirTree(DIR);
			FS.mount(Module.IDBFS, {}, DIR);
			FS.chdir('/xrogue');
			Module.ENV.HOME = DIR;               /* xrogue.sav (md_gethomedir) */
			Module.ENV.ROGUEHOME = DIR;          /* score file */
			Module.ENV.USER = 'rogue';
			Module.addRunDependency('idbfs');
			FS.syncfs(true, function (err) {
				if (err) status('Could not read saved games from IndexedDB (' + err + '). Saving may not work in this browser mode.', true);
				loadLayout();                    /* before the game: it holds the name and the tile set */
				if (!L.name) { L.name = (prompt('What is your name, adventurer?', '') || '').replace(/[,\n]/g, '').trim().slice(0, 30); if (L.name) saveLayout(); }
				if (L.name) Module.ENV.ROGUEOPTS = 'name=' + L.name;
				TILESETS.forEach(function (t, i) { if (t[1] === L.tiles) tileset = i; });
				startTiles();
				Module.removeRunDependency('idbfs');
			});
		}],
		onRuntimeInitialized: function () {
			app.running = true;
			status('');
		},
		print: function (s) { console.log(s); },
		printErr: function (s) { console.warn(s); },
		setStatus: function (s) { if (s && !app.running) status(s.replace(/\(\d+\/\d+\)/, '').trim() || 'Loading…'); },
		onAbort: function (what) { app.crashed(what); }
	};
	function tilesFinished(ok) {
		tilesReady = ok; tilesDone = true;
		if (!ok) status('Could not load the tile set; using text.', true);
		if (tilesWait) Module.removeRunDependency('tiles');
	}
	tiles.onload = function () { tilesFinished(true); };
	tiles.onerror = function () { tilesFinished(false); };
	/* tile sets: same slot layout (port/mkdawn.py); the choice is a per-browser preference */
	var TILESETS = [['tiles.png', 'NetHack'], ['tiles-dawn.png', 'DawnLike'], ['tiles-dawn.png', 'DawnLike|a', 'tiles-dawn-1.png'], [null, 'None']], tileset = 0;
	/* animation (opt-in, "DawnLike|a"): the map swaps to the frame-1 sheet
	 * (port/mkdawn.py) twice a second, redrawing only cells whose sprite has
	 * a different 2nd frame (anim[slot], found by comparing the two sheets) */
	var tiles1 = new Image(), frame = 0, anim = null;
	function loadFrame1() { frame = 0; anim = null; if (TILESETS[tileset][2]) tiles1.src = TILESETS[tileset][2]; else tiles1.removeAttribute('src'); }
	function pixels(im) {
		var c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
		var x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, c.width, c.height).data;
	}
	function findAnim() {
		if (!tiles.naturalWidth || !tiles1.naturalWidth) return;
		var a = pixels(tiles), b = pixels(tiles1), W = tiles.naturalWidth, n = (W / 16) * (tiles.naturalHeight / 16);
		anim = new Uint8Array(n);
		for (var s = 0; s < n; s++)
			for (var y = 0, x0 = (s % (W / 16)) * 16, y0 = ((s / (W / 16)) | 0) * 16; y < 16 && !anim[s]; y++)
				for (var i = ((y0 + y) * W + x0) * 4, e = i + 64; i < e; i++) if (a[i] !== b[i]) { anim[s] = 1; break; }
	}
	tiles1.onload = findAnim;
	setInterval(function () {
		var T = panes[P_MAP];
		if (!T || !tilesReady || !TILESETS[tileset][2] || document.hidden) return;
		if (!anim) findAnim();
		if (!anim) return;
		frame ^= 1;
		for (var i = 0; i < T.cols * T.rows; i++) if (anim[T.t[i]] || anim[T.u[i]]) draw(P_MAP, (i / T.cols) | 0, i % T.cols);
		drawCursor();
	}, 500);
	function renderTileset() { var b = $('btn-tiles'); if (b) b.textContent = 'Tiles: ' + TILESETS[tileset][1]; }
	function toggleTileset() {
		tileset = (tileset + 1) % TILESETS.length;
		L.tiles = TILESETS[tileset][1]; saveLayout();
		renderTileset();
		var redraw = function () {
			if (panes[P_MAP]) shape(P_MAP);
			if (txt[P_INV]) for (var y = 0; y < txt[P_INV].n; y++) drawRow(P_INV, y);
			var vb = document.querySelector('#t-vis .body');
			if (vb && vb._vis != null) { var s = vb._vis; vb._vis = null; xr.vis(s); }
			if (xr.atCmd) events.push(12);   /* ^L: the game redraws, the Inventory gets or drops its icons */
			applyDom();
		};
		renderMapSel();
		loadFrame1();
		if (!TILESETS[tileset][0]) { tilesReady = false; redraw(); return; }   /* text mode */
		/* a sheet that finishes late must not turn tiles back on after None */
		tiles.onload = function () { if (TILESETS[tileset][0]) { tilesReady = true; redraw(); } };
		tiles.src = TILESETS[tileset][0];
	}
	/* map font chooser: on the Map title bar (shown on hover), text mode only */
	var mapSel = document.createElement('select');
	mapSel.title = 'Map font (text mode)';
	mapSel.innerHTML = '<option value="">Default font</option>';
	mapSel.addEventListener('pointerdown', function (e) { e.stopPropagation(); });   /* not a window drag */
	function renderMapSel() {
		var bs = document.querySelector('#t-map .wm-btns');
		if (bs && mapSel.parentNode !== bs) bs.insertBefore(mapSel, bs.firstChild);
		mapSel.hidden = !!TILESETS[tileset][0];
		mapSel.value = (L && L.mapFace) || '';
	}
	/* text font: a face from the index page's fonts/ (web/build.sh lists them) */
	function loadFace(n, now) {
		var redraw = function () { if (panes[P_MAP]) shape(P_MAP); applyFace(); applyDom(); };
		if (!n) { if (now) redraw(); return; }
		var ff = new FontFace(n, 'url(../fonts/' + n + '.woff)');
		ff.load().then(function () { document.fonts.add(ff); redraw(); }).catch(function () { status('Could not load the font ' + n + '.', true); });
	}
	/* the top-bar font on every text window and the pop-up */
	function applyFace() {
		['#t-stat .body', '#t-msg .body', '#t-inv .body', '#t-vis .body', '#pop'].forEach(function (q) { var e = document.querySelector(q); if (e) e.style.fontFamily = face(P_STATUS); });
	}
	/* Visible window icon: the tile as a CSS sprite */
	function visIcon(t) {
		if (!tilesReady || !(t >= 0)) return null;
		var s = document.createElement('i');
		s.className = 'wm-ic';
		s.style.cssText = 'image-rendering:pixelated;background:url(' + tiles.src + ') -' + (t % 32) * 16 + 'px -' + ((t / 32) | 0) * 16 + 'px';
		return s;
	}
	function startTiles() {
		renderTileset(); loadFrame1();
		if (TILESETS[tileset][0]) tiles.src = TILESETS[tileset][0];
		else { tilesDone = true; if (tilesWait) Module.removeRunDependency('tiles'); }   /* None: text */
	}

	/* autosave: every 2 minutes and when the page is hidden */
	setInterval(function () { saveReq = true; }, 120000);
	document.addEventListener('visibilitychange', function () { if (document.hidden) saveReq = true; });
	window.addEventListener('beforeunload', function (e) { if (app.running) { e.preventDefault(); e.returnValue = ''; } });

	document.addEventListener('keydown', onKey);
	document.addEventListener('DOMContentLoaded', function () {
		$('btn-tiles').onclick = toggleTileset;
		renderTileset();
		$('chk-sound').onchange = function () { toggleAudio('sound'); };
		RvipWM.dropdown($('btn-audio'), $('menu-audio'));
		RvipWM.dropdown($('btn-file'), $('menu-file'));
		fetch('fonts.json').then(function (r) { return r.json(); }).then(function (list) {
			[[$('sel-font'), 'face'], [mapSel, 'mapFace']].forEach(function (a) {
				list.forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = n.replace(/^Web(Plus|437)_/, '').replace(/_/g, ' '); a[0].appendChild(o); });
				a[0].value = (L && L[a[1]]) || '';
			});
		}).catch(function () { });
		[[$('sel-font'), 'face'], [mapSel, 'mapFace']].forEach(function (a) {
			a[0].onchange = function () { if (!L) return; L[a[1]] = this.value; saveLayout(); loadFace(this.value, true); this.blur(); };
		});
		$('btn-restart').onclick = function () { location.reload(); };
		renderAudio();
		document.querySelectorAll('button').forEach(function (b) {
			b.addEventListener('mousedown', function (e) { e.preventDefault(); });
		});
	});
	var resizeTimer = 0;
	window.addEventListener('resize', function () {
		if (!L) return;
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(function () {
			if (L.auto) {                        /* not customised: follow the window */
				var d = defaultLayout();
				if (d.tile !== L.tile) { L.tile = d.tile; shape(P_MAP); }
			}
			applyDom();
		}, 150);
	});
})();
