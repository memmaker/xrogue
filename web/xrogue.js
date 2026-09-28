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
	function measure(px, p) {
		var c = document.createElement('canvas').getContext('2d');
		c.font = px + 'px ' + face(p);
		return Math.ceil(c.measureText('M').width);
	}

	/* Cell size from the zoom settings; rebuilds the canvas and redraws */
	function shape(p) {
		var T = panes[p];
		if (p === P_MAP) { T.cw = T.ch = L.tile; T.pad = 0; }
		else {
			var f = RvipWM.fontSize(p === P_POP ? popWin : WIN[p]);
			T.fs = f; T.cw = measure(f, p); T.ch = Math.round(f * 1.3); T.pad = p === P_POP ? T.cw : 0;
			T.font = f + 'px ' + face(p);
		}
		if (p === P_MAP) T.font = (L.mapFace ? '' : 'bold ') + Math.round(T.ch * 0.8) + 'px ' + face(p);
		var w = T.cols * T.cw + 2 * T.pad, h = T.rows * T.ch + 2 * T.pad;
		T.cv.width = Math.round(w * dpr); T.cv.height = Math.round(h * dpr);
		T.w = w; T.h = h;
		T.ctx = T.cv.getContext('2d');
		T.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		T.ctx.imageSmoothingEnabled = false;                 /* nearest-neighbour tiles */
		T.ctx.fillStyle = BG; T.ctx.fillRect(0, 0, w, h);
		for (var i = 0; i < T.cols * T.rows; i++) draw(p, (i / T.cols) | 0, i % T.cols);
		fit(p);
	}

	function makePane(p, cols, rows) {
		var cv = p === P_POP ? document.querySelector('#pop canvas') : document.querySelector('#t-' + WIN[p] + ' canvas');
		var n = cols * rows;
		panes[p] = { cv: cv, cols: cols, rows: rows, ch_: new Int32Array(n).fill(32),
			t: new Int32Array(n).fill(-1), u: new Int32Array(n).fill(-1) };
		shape(p);
	}

	function draw(p, y, x) {
		var T = panes[p], c = T.ctx, i = y * T.cols + x;
		var ch = T.ch_[i], t = T.t[i], u = T.u[i];
		var px = T.pad + x * T.cw, py = T.pad + y * T.ch;
		var inv = !!(ch & 0x100);
		c.fillStyle = inv ? FG : BG;
		c.fillRect(px, py, T.cw, T.ch);
		if (t >= 0 && tilesReady) {
			var im = p === P_MAP && frame && tiles1.naturalWidth ? tiles1 : tiles;   /* DawnLike's 2nd frame */
			if (u >= 0) c.drawImage(im, (u % 32) * 16, ((u / 32) | 0) * 16, 16, 16, px, py, T.cw, T.ch);
			c.drawImage(im, (t % 32) * 16, ((t / 32) | 0) * 16, 16, 16, px, py, T.cw, T.ch);
			return;
		}
		var ic = p === P_INV && T.rowIcon ? T.rowIcon[y] : -1;
		if (ic >= 0 && tilesReady && x >= 2 && x <= 4) {   /* square, whatever the font's cell shape; centred in cols 2-4 */
			var s = Math.min(2 * T.cw, T.ch), ix = T.pad + 2 * T.cw + (3 * T.cw - s) / 2;
			c.save(); c.beginPath(); c.rect(px, py, T.cw, T.ch); c.clip();
			c.drawImage(tiles, (ic % 32) * 16, ((ic / 32) | 0) * 16, 16, 16, ix, py + (T.ch - s) / 2, s, s);
			c.restore();
			return;
		}
		var k = ch & 0xff;
		if (k > 32) {
			c.font = T.font;
			c.textAlign = 'center'; c.textBaseline = 'middle';
			c.fillStyle = inv ? BG : (T.rowFg && T.rowFg[y]) || FG;
			c.fillText(String.fromCharCode(k), px + T.cw / 2, py + T.ch / 2 + 1);
		}
	}

	function drawCursor() {
		var T = panes[cur.p];
		if (!T || cur.y >= T.rows || cur.x >= T.cols) return;
		var c = T.ctx, px = T.pad + cur.x * T.cw, py = T.pad + cur.y * T.ch;
		if (cur.p === P_MAP && cur.y === hero.y && cur.x === hero.x) return;   /* the hero is marker enough */
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
			audio: { sound: false, music: false } };
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
				if (s.audio) d.audio = { sound: s.audio.sound === true, music: s.audio.music === true };
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

	/* Show a canvas at its size, or scaled down to fit its window (never clipped) */
	function fit(p) {
		var T = panes[p];
		if (!T) return;
		var box;
		if (p === P_POP) {
			if (!rects.map) return;
			var A = RvipWM.popupBox();
			box = { w: A.w - 2 * L.tile, h: A.h };
		} else {
			var r = rects[WIN[p]];
			if (!r) return;
			box = { w: r[2] - BORDER, h: r[3] - BORDER - ($('game').classList.contains('wm-single') ? 0 : TITLE_H) };
		}
		/* the map never shrinks: bigger than its window, it scrolls with the hero */
		if (p === P_MAP) { T.box = box; scrollMap(true); return; }
		var sc = Math.min(1, box.w / T.w, box.h / T.h);
		T.cv.style.width = T.w * sc + 'px';
		T.cv.style.height = T.h * sc + 'px';
		if (p === P_POP) RvipWM.popup($('pop'), { x: L.tile });
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

	var wm = null, popWin = 'msg';   /* pop-ups follow the last zoomed text window */
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
			layout: function (r) { rects = r; WIN.forEach(function (id, p) { fit(p); }); fit(P_POP); },
			zoom: { map: function (size, d) { zoomMap(d); }, msg: zoomText, stat: zoomText, inv: zoomText },
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

	/* a text pane's A− / A+: the WM keeps the size; redraw that pane at it */
	function zoomText() {
		for (var p = 1; p < WIN.length; p++) if (panes[p] && RvipWM.fontSize(WIN[p]) !== panes[p].fs) { popWin = WIN[p]; shape(p); }
		if (panes[P_POP]) shape(P_POP);
		applyDom();
	}

	function resetLayout() {
		var a = L.audio, fc = L.face, mf = L.mapFace;
		L = defaultLayout(); L.audio = a; L.face = fc; L.mapFace = mf; L.wm = wm.state();
		for (var p = 0; p < panes.length; p++) if (panes[p]) shape(p);
		applyDom(); saveLayout();
	}

	/* ---------- sound ---------- */
	/* sound events come from the game (be_sound() calls in the sources), named
	 * like the Dubtrain Angband Sound Pack's (web/sounds.py copies the samples) */
	var audio = { cfg: {}, cache: {}, level: -1, town: false, el: null };
	fetch('sound/sounds.json').then(function (r) { return r.json(); }).then(function (c) { audio.cfg = c; }).catch(function () { });

	function play(name) {
		var files = L && L.audio.sound && audio.cfg[name];
		if (!files || !files.length) return;
		var f = files[Math.floor(Math.random() * files.length)];
		if (!audio.cache[f]) audio.cache[f] = new Audio('sound/' + f);
		var a = audio.cache[f].cloneNode();
		a.volume = 0.6;
		a.play().catch(function () { });
	}
	function updateMusic() {
		var on = L && L.audio.music && audio.town && app.running;
		if (on && !audio.el) {
			audio.el = new Audio('music/new_town.ogg');
			audio.el.loop = true; audio.el.volume = 0.4;
		}
		if (!audio.el) return;
		if (on) audio.el.play().catch(function () { }); else audio.el.pause();
	}
	function toggleAudio(k) {
		L.audio[k] = !L.audio[k];
		renderAudio(); updateMusic(); saveLayout();
	}
	function renderAudio() {
		var a = L ? L.audio : { sound: false, music: false };
		$('chk-sound').checked = a.sound;
		$('chk-music').checked = a.music;
	}

	/* ---------- called by the game (port/be_web.c) ---------- */
	var xr = {
		init: function (p, cols, rows) {
			if (!L) loadLayout();
			makePane(p, cols, rows);
			if (p === P_INV) { $('game').hidden = false; makeWM(); for (var q = 1; q <= P_INV; q++) shape(q); }
		},
		put: function (p, y, x, ch, t, u) {
			var T = panes[p];
			if (!T || y < 0 || x < 0 || y >= T.rows || x >= T.cols) return;
			var i = y * T.cols + x;
			T.ch_[i] = ch; T.t[i] = t; T.u[i] = u;
			draw(p, y, x);
		},
		cursor: function (p, y, x) { cur.p = p; cur.y = y; cur.x = x; },
		popup: function (rows, cols) {
			if (!rows) { $('pop').hidden = true; panes[P_POP] = null; if (cur.p === P_POP) cur.p = -1; return; }
			makePane(P_POP, cols, rows);
			$('pop').hidden = false;
			fit(P_POP);
		},
		flush: function (level, town, hy, hx) {
			if (hy !== hero.y || hx !== hero.x) { hero.y = hy; hero.x = hx; scrollMap(level !== audio.level); }
			/* the cursor is drawn over the cell; redraw that cell next time */
			if (xr.lastCur && panes[xr.lastCur.p]) draw(xr.lastCur.p, xr.lastCur.y, xr.lastCur.x);
			drawCursor();
			var mb = panes[P_MSG] && panes[P_MSG].cv.parentNode;   /* follow the newest message */
			if (mb) mb.scrollTop = mb.scrollHeight;
			xr.lastCur = cur.p >= 0 ? { p: cur.p, y: cur.y, x: cur.x } : null;
			audio.level = level;
			if (!!town !== audio.town) { audio.town = !!town; updateMusic(); }
		},
		invfg: function (y, c, t) {   /* the game's colour and icon tile for an inventory row */
			var T = panes[P_INV];
			if (!T || y >= T.rows) return;
			(T.rowFg = T.rowFg || [])[y] = c;
			(T.rowIcon = T.rowIcon || [])[y] = t;
			for (var x = 0; x < T.cols; x++) draw(P_INV, y, x);
		},
		rowfg: function (p, y, c) {   /* the game's colour for a pop-up row */
			var T = panes[p];
			if (!T || y >= T.rows) return;
			(T.rowFg = T.rowFg || [])[y] = c;
			for (var x = 0; x < T.cols; x++) draw(p, y, x);
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
			updateMusic();
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
			if (!tilesDone) { Module.addRunDependency('tiles'); tilesWait = true; }
			FS.mkdirTree(DIR);
			FS.mount(Module.IDBFS, {}, DIR);
			FS.chdir('/xrogue');
			Module.ENV.HOME = DIR;               /* xrogue.sav (md_gethomedir) */
			Module.ENV.ROGUEHOME = DIR;          /* score file */
			Module.ENV.USER = 'rogue';
			var who = '';                        /* whoami: getpwuid() is web_user, so ask once */
			try { who = localStorage.getItem('xrogue-name') || ''; } catch (err) { /* no storage */ }
			if (!who) { who = (prompt('What is your name, adventurer?', '') || '').replace(/[,\n]/g, '').trim().slice(0, 30); try { if (who) localStorage.setItem('xrogue-name', who); } catch (err) { /* no storage */ } }
			if (who) Module.ENV.ROGUEOPTS = 'name=' + who;
			Module.addRunDependency('idbfs');
			FS.syncfs(true, function (err) {
				if (err) status('Could not read saved games from IndexedDB (' + err + '). Saving may not work in this browser mode.', true);
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
	try { tileset = +localStorage.getItem('tileset') % TILESETS.length || 0; } catch (err) { /* no storage */ }
	function renderTileset() { var b = $('btn-tiles'); if (b) b.textContent = 'Tiles: ' + TILESETS[tileset][1]; }
	function toggleTileset() {
		tileset = (tileset + 1) % TILESETS.length;
		try { localStorage.setItem('tileset', tileset); } catch (err) { /* no storage */ }
		renderTileset();
		var redraw = function () {
			[P_MAP, P_INV].forEach(function (p) { if (panes[p]) shape(p); });
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
		var redraw = function () { for (var p = 0; p < panes.length; p++) if (panes[p]) shape(p); document.querySelector('#t-vis .body').style.fontFamily = L.face ? '"' + L.face + '", monospace' : ''; applyDom(); };
		if (!n) { if (now) redraw(); return; }
		var ff = new FontFace(n, 'url(../fonts/' + n + '.woff)');
		ff.load().then(function () { document.fonts.add(ff); redraw(); }).catch(function () { status('Could not load the font ' + n + '.', true); });
	}
	/* Visible window icon: the tile as a CSS sprite */
	function visIcon(t) {
		if (!tilesReady || !(t >= 0)) return null;
		var s = document.createElement('i');
		s.className = 'wm-ic';
		s.style.cssText = 'image-rendering:pixelated;background:url(' + tiles.src + ') -' + (t % 32) * 16 + 'px -' + ((t / 32) | 0) * 16 + 'px';
		return s;
	}
	if (TILESETS[tileset][0]) tiles.src = TILESETS[tileset][0]; else tilesDone = true;
	loadFrame1();

	/* autosave: every 2 minutes and when the page is hidden */
	setInterval(function () { saveReq = true; }, 120000);
	document.addEventListener('visibilitychange', function () { if (document.hidden) saveReq = true; });
	window.addEventListener('beforeunload', function (e) { if (app.running) { e.preventDefault(); e.returnValue = ''; } });

	document.addEventListener('keydown', onKey);
	document.addEventListener('DOMContentLoaded', function () {
		$('btn-tiles').onclick = toggleTileset;
		renderTileset();
		$('chk-sound').onchange = function () { toggleAudio('sound'); };
		$('chk-music').onchange = function () { toggleAudio('music'); };
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
