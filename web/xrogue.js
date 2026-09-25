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
	var FONT_MIN = 8, FONT_MAX = 28;
	/* curses key codes (port/curses.h) */
	var KEY = { ArrowDown: 258, ArrowUp: 259, ArrowLeft: 260, ArrowRight: 261,
		Home: 348, PageUp: 349, End: 351, PageDown: 352 };
	var NUMPAD = { 1: 351, 2: 258, 3: 352, 4: 260, 5: 350, 6: 261, 7: 348, 8: 259, 9: 349 };

	var panes = [];            /* {cv, ctx, cols, rows, cw, ch, pad, buf} */
	var events = [];
	var tiles = new Image(), tilesReady = false;
	var running = false, saveReq = false;
	var cur = { p: -1, y: 0, x: 0 };
	var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
	var L = null, rects = {};

	function $(id) { return document.getElementById(id); }
	function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
	function status(msg, isError) {
		var s = $('status');
		s.textContent = msg;
		s.className = isError ? 'error' : '';
		s.hidden = !msg;
	}

	/* ---------- panes ---------- */

	function measure(px) {
		var c = document.createElement('canvas').getContext('2d');
		c.font = px + 'px ' + FONT;
		return Math.ceil(c.measureText('M').width);
	}

	/* Cell size from the zoom settings; rebuilds the canvas and redraws */
	function shape(p) {
		var T = panes[p];
		if (p === P_MAP) { T.cw = T.ch = L.tile; T.pad = 0; }
		else {
			var f = p === P_POP ? L.font.pop : L.font[WIN[p]];
			T.cw = measure(f); T.ch = Math.round(f * 1.3); T.pad = p === P_POP ? T.cw : 0;
			T.font = f + 'px ' + FONT;
		}
		if (p === P_MAP) T.font = 'bold ' + Math.round(T.ch * 0.8) + 'px ' + FONT;
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
			if (u >= 0) c.drawImage(tiles, (u % 32) * 16, ((u / 32) | 0) * 16, 16, 16, px, py, T.cw, T.ch);
			c.drawImage(tiles, (t % 32) * 16, ((t / 32) | 0) * 16, 16, 16, px, py, T.cw, T.ch);
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
		if (!T || cur.y >= T.rows || cur.x >= T.cols) return;
		var c = T.ctx, px = T.pad + cur.x * T.cw, py = T.pad + cur.y * T.ch;
		c.fillStyle = c.strokeStyle = FG;
		if (T.t[cur.y * T.cols + cur.x] >= 0) { c.lineWidth = 1; c.strokeRect(px + 0.5, py + 0.5, T.cw - 1, T.ch - 1); }
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
		var font = W >= 1600 ? 14 : 13, tile = TILE_STEPS[0];
		TILE_STEPS.forEach(function (t) { if (80 * t + BORDER <= W && 21 * t + BORDER <= H * 0.6) tile = t; });
		var mapH = 21 * tile + BORDER, lower = H - mapH - GUT;
		var statH = TITLE_H + BORDER + 2 * Math.round(font * 1.3) + 4;
		return { v: 1, tile: tile, auto: true, font: { msg: font, stat: font, inv: font, pop: font },
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
				Object.keys(d.font).forEach(function (k) {
					if (s.font && s.font[k] >= FONT_MIN && s.font[k] <= FONT_MAX) d.font[k] = s.font[k];
				});
				if (s.audio) d.audio = { sound: s.audio.sound === true, music: s.audio.music === true };
			}
		} catch (err) { /* nothing saved yet */ }
		L = d;
		renderAudio();
	}

	var saveTimer = 0;
	function saveLayout() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(function () {
			try { Module.FS.writeFile(LAYOUT_FILE, JSON.stringify(L)); syncFiles(); }
			catch (err) { console.warn('layout not saved', err); }
		}, 400);
	}

	function computeRects() {
		var A = areaSize(), W = A.w, H = A.h, h = GUT / 2, s = L.split;
		var yb = clamp(Math.round(H * s.bottom), 120, H - 120);
		var xs = clamp(Math.round(W * s.side), 120, W - 120);
		var lower = H - yb;
		var ys = clamp(Math.round(yb + lower * s.stat), yb + 60, H - 40);
		return {
			map: [0, 0, W, yb - h],
			msg: [0, yb + h, xs - h, ys - yb - GUT],
			stat: [0, ys + h, xs - h, H - ys - h],
			inv: [xs + h, yb + h, W - xs - h, H - yb - h],
			split: { bottom: [0, yb - h, W, GUT], side: [xs - h, yb + h, GUT, H - yb - h], stat: [0, ys - h, xs - h, GUT] }
		};
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
			var m = rects.map, A = areaSize();
			box = { w: A.w - m[0] - 2 * L.tile, h: A.h - 8 };
		} else {
			var r = rects[WIN[p]];
			if (!r) return;
			box = { w: r[2] - BORDER, h: r[3] - BORDER - (p === P_MAP ? 0 : TITLE_H) };
		}
		/* the map never shrinks: bigger than its window, it scrolls with the hero */
		if (p === P_MAP) { T.box = box; scrollMap(true); return; }
		var sc = Math.min(1, box.w / T.w, box.h / T.h);
		T.cv.style.width = T.w * sc + 'px';
		T.cv.style.height = T.h * sc + 'px';
		if (p === P_POP) { var pop = $('pop'); pop.style.left = rects.map[0] + L.tile + 'px'; pop.style.top = rects.map[1] + 4 + 'px'; }
	}

	var hero = { y: 0, x: 0 }, off = { x: 0, y: 0 };
	/* Keep the hero in the middle half of the map window; recentre when it
	 * leaves it (or always, after a zoom, resize or new level) */
	function scrollMap(force) {
		var T = panes[P_MAP];
		if (!T || !T.box) return;
		T.cv.style.width = T.w + 'px'; T.cv.style.height = T.h + 'px';
		['x', 'y'].forEach(function (a) {
			var size = a === 'x' ? T.w : T.h, view = a === 'x' ? T.box.w : T.box.h;
			var c = (a === 'x' ? hero.x * T.cw : hero.y * T.ch) + T.cw / 2 - off[a];
			if (size <= view) off[a] = 0;
			else if (force || c < view / 4 || c > view * 3 / 4)
				off[a] = clamp(Math.round(c + off[a] - view / 2), 0, size - view);
		});
		T.cv.style.marginLeft = -off.x + 'px';
		T.cv.style.marginTop = -off.y + 'px';
	}

	function applyDom() {
		rects = computeRects();
		WIN.forEach(function (id, p) { place($('t-' + id), rects[id]); fit(p); });
		SPLITS.forEach(function (k) { place($('split-' + k), rects.split[k]); });
		fit(P_POP);
	}

	function startDrag(k, e) {
		var el = $('split-' + k);
		el.setPointerCapture(e.pointerId);
		el.classList.add('drag');
		function move(ev) {
			var g = $('game').getBoundingClientRect(), H = g.height;
			if (k === 'bottom') L.split.bottom = clamp((ev.clientY - g.top) / H, 0.1, 0.9);
			if (k === 'side') L.split.side = clamp((ev.clientX - g.left) / g.width, 0.1, 0.9);
			if (k === 'stat') {
				var yb = H * L.split.bottom;
				L.split.stat = clamp((ev.clientY - g.top - yb) / (H - yb), 0.1, 0.95);
			}
			L.auto = false;
			applyDom();
		}
		function up() {
			el.classList.remove('drag');
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
			saveLayout();
		}
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
		e.preventDefault();
	}

	function zoomMap(d) {
		var i = clamp(TILE_STEPS.indexOf(L.tile) + d, 0, TILE_STEPS.length - 1);
		L.tile = TILE_STEPS[i]; L.auto = false;
		shape(P_MAP); applyDom(); saveLayout();
		status('Map tiles: ' + L.tile + ' px');
		setTimeout(function () { status(''); }, 1200);
	}

	function zoomText(id, d) {
		var ids = [id];
		ids.forEach(function (k) { L.font[k] = clamp(L.font[k] + d, FONT_MIN, FONT_MAX); });
		L.font.pop = L.font[ids[0]];            /* pop-ups follow the last zoomed window */
		WIN.forEach(function (w, p) { if (p && ids.indexOf(w) >= 0) shape(p); });
		if (panes[P_POP]) shape(P_POP);
		applyDom(); saveLayout();
	}

	function resetLayout() {
		var a = L.audio;
		L = defaultLayout(); L.audio = a;
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
		var on = L && L.audio.music && audio.town && running;
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
		$('btn-sound').textContent = 'Sound: ' + (a.sound ? 'on' : 'off');
		$('btn-music').textContent = 'Music: ' + (a.music ? 'on' : 'off');
	}

	/* ---------- called by the game (port/be_web.c) ---------- */
	var xr = {
		init: function (p, cols, rows) {
			if (!L) loadLayout();
			makePane(p, cols, rows);
			if (p === P_INV) { $('game').hidden = false; applyDom(); }
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
			xr.lastCur = cur.p >= 0 ? { p: cur.p, y: cur.y, x: cur.x } : null;
			audio.level = level;
			if (!!town !== audio.town) { audio.town = !!town; updateMusic(); }
		},
		key: function () { return events.length ? events.shift() : -1; },
		requestSave: function () { saveReq = true; },   /* also for testing */
		wantSave: function () {
			if (!saveReq || !running) return 0;
			saveReq = false;
			setTimeout(syncFiles, 0);           /* after the game wrote the file */
			return 1;
		},
		sound: function (name) { play(name); },
		end: function (saved, dead) {
			running = false;
			updateMusic();
			syncFiles(function () {
				$('overlay-msg').textContent = saved ? 'Your game has been saved. Play again to continue it.'
					: dead ? 'Your character died. The game is over.' : 'The game is over.';
				$('overlay').hidden = false;
			});
		}
	};

	/* ---------- input ---------- */
	function onKey(e) {
		if (!$('help').hidden) {
			if (e.key === 'Escape') { $('help').hidden = true; e.preventDefault(); }
			return;
		}
		if (!running || e.isComposing || e.metaKey) return;
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

	/* ---------- saves: IndexedDB (IDBFS) ---------- */
	var syncing = false, syncAgain = false, pendingCbs = [];
	function syncFiles(cb) {
		if (!Module.FS) { if (cb) cb(); return; }
		if (typeof cb === 'function') pendingCbs.push(cb);
		if (syncing) { syncAgain = true; return; }
		syncing = true;
		var cbs = pendingCbs; pendingCbs = [];
		Module.FS.syncfs(false, function (err) {
			syncing = false;
			if (err) status('Saving to browser storage (IndexedDB) failed: ' + err + '. Use "Export save" to keep a copy.', true);
			cbs.forEach(function (f) { f(err); });
			if (syncAgain) { syncAgain = false; syncFiles(); }
		});
	}
	function hasSave() { try { Module.FS.stat(SAVE); return true; } catch (e) { return false; } }
	function exportSave() {
		if (running) saveReq = true;
		setTimeout(function () {
			if (!hasSave()) { status('There is no saved game yet.', true); return; }
			var a = document.createElement('a');
			a.href = URL.createObjectURL(new Blob([Module.FS.readFile(SAVE)], { type: 'application/octet-stream' }));
			a.download = 'xrogue.sav';
			document.body.appendChild(a); a.click();
			setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
		}, running ? 1500 : 0);
	}
	function importSave(file) {
		var r = new FileReader();
		r.onload = function () {
			if (!confirm('Replace the current game with "' + file.name + '"?')) return;
			running = false;
			Module.FS.writeFile(SAVE, new Uint8Array(r.result));
			syncFiles(function (err) { if (!err) location.reload(); });
		};
		r.readAsArrayBuffer(file);
	}
	function newGame() {
		if (!confirm('Delete the saved game in this browser and start a new one?')) return;
		running = false;
		if (hasSave()) Module.FS.unlink(SAVE);
		syncFiles(function (err) { if (!err) location.reload(); });
	}

	/* ---------- help ---------- */
	var helpLoaded = false;
	function toggleHelp() {
		var h = $('help');
		h.hidden = !h.hidden;
		if (!h.hidden && !helpLoaded) {
			helpLoaded = true;
			fetch('help.html').then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
				.then(function (t) { $('help-body').innerHTML = t; })
				.catch(function (err) { helpLoaded = false; $('help-body').textContent = 'Could not load the guide (' + err + '). Press ? in the game for its own help.'; });
		}
		if (!h.hidden) $('help-body').focus();
	}

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
			Module.addRunDependency('idbfs');
			FS.syncfs(true, function (err) {
				if (err) status('Could not read saved games from IndexedDB (' + err + '). Saving may not work in this browser mode.', true);
				Module.removeRunDependency('idbfs');
			});
		}],
		onRuntimeInitialized: function () {
			running = true;
			status('');
		},
		print: function (s) { console.log(s); },
		printErr: function (s) { console.warn(s); },
		setStatus: function (s) { if (s && !running) status(s.replace(/\(\d+\/\d+\)/, '').trim() || 'Loading…'); },
		onAbort: function (what) { crashed(what); }
	};
	function tilesFinished(ok) {
		tilesReady = ok; tilesDone = true;
		if (!ok) status('Could not load the tile set; using text.', true);
		if (tilesWait) Module.removeRunDependency('tiles');
	}
	tiles.onload = function () { tilesFinished(true); };
	tiles.onerror = function () { tilesFinished(false); };
	tiles.src = 'tiles.png';

	function crashed(err) {
		if (!running) return;
		running = false;
		var msg = (err && (err.message || err.reason && err.reason.message)) || String(err);
		console.error('[xrogue] crash:', err);
		status('The game crashed (' + msg + '). Reload the page to continue from the last autosave.', true);
	}
	window.addEventListener('unhandledrejection', function (e) {
		/* exit() unwinds with an ExitStatus; that is the normal end */
		if (e.reason && e.reason.name === 'ExitStatus') return;
		crashed(e.reason);
	});
	window.addEventListener('error', function (e) {
		if (e.error && e.error.name === 'ExitStatus') return;
		if (e.error instanceof WebAssembly.RuntimeError || /xrogue-core/.test(e.filename || '')) crashed(e.error || e.message);
	});

	/* autosave: every 2 minutes and when the page is hidden */
	setInterval(function () { saveReq = true; }, 120000);
	document.addEventListener('visibilitychange', function () { if (document.hidden) saveReq = true; });
	window.addEventListener('beforeunload', function (e) { if (running) { e.preventDefault(); e.returnValue = ''; } });

	document.addEventListener('keydown', onKey);
	document.addEventListener('DOMContentLoaded', function () {
		$('btn-export').onclick = exportSave;
		$('btn-import').onclick = function () { $('import-file').click(); };
		$('import-file').onchange = function () { if (this.files[0]) importSave(this.files[0]); this.value = ''; };
		$('btn-new').onclick = newGame;
		$('btn-help').onclick = toggleHelp;
		$('help-close').onclick = toggleHelp;
		$('btn-zoom-in').onclick = function () { zoomMap(1); };
		$('btn-zoom-out').onclick = function () { zoomMap(-1); };
		$('btn-layout').onclick = resetLayout;
		$('btn-sound').onclick = function () { toggleAudio('sound'); };
		$('btn-music').onclick = function () { toggleAudio('music'); };
		$('btn-restart').onclick = function () { location.reload(); };
		renderAudio();
		document.querySelectorAll('button').forEach(function (b) {
			b.addEventListener('mousedown', function (e) { e.preventDefault(); });
		});
		SPLITS.forEach(function (k) { $('split-' + k).addEventListener('pointerdown', function (e) { startDrag(k, e); }); });
		['msg', 'stat', 'inv'].forEach(function (id) {
			var w = $('t-' + id);
			w.querySelector('.zin').addEventListener('click', function () { zoomText(id, 1); });
			w.querySelector('.zout').addEventListener('click', function () { zoomText(id, -1); });
		});
	});
	var resizeTimer = 0;
	window.addEventListener('resize', function () {
		if (!L) return;
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(function () {
			if (L.auto) {                        /* not customised: follow the window */
				var d = defaultLayout();
				L.split = d.split;
				if (d.tile !== L.tile) { L.tile = d.tile; shape(P_MAP); }
			}
			applyDom();
		}, 150);
	});
})();
