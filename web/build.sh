#!/bin/sh
# Build XRogue for the browser (Emscripten + Asyncify) into web/dist;
# deploy with web/deploy.sh. Run with sh (zsh doesn't split $SRCS).
set -e
cd "$(dirname "$0")/.."
OUT=web/dist
rm -rf "$OUT" && mkdir -p "$OUT"
SRCS=$(sed -n '/^CFILES=/,/^$/p' Makefile | tr -d '\\\r' | sed 's/^CFILES=//')
# ponytail: EMULATE_FUNCTION_POINTER_CASTS because ~36 daemon/fuse callbacks
# take 0 args but daemon.c calls them with 1 (a WebAssembly trap); giving
# each one a real signature would allow dropping it.
emcc -O2 -fcommon -std=gnu89 -w -Wno-error=return-mismatch -Wno-error=implicit-function-declaration -Wno-error=implicit-int -Wno-error=int-conversion -Wno-error=incompatible-pointer-types -Iport \
	$SRCS port/wcurses.c port/tiles.c port/be_web.c \
	-o "$OUT/xrogue-core.js" \
	-sASYNCIFY -sASYNCIFY_STACK_SIZE=65536 -sSTACK_SIZE=1048576 \
	-sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=32MB \
	-sEXPORTED_FUNCTIONS=_main \
	-sEXPORTED_RUNTIME_METHODS=FS,IDBFS,ENV,HEAPU8,addRunDependency,removeRunDependency \
	-sEMULATE_FUNCTION_POINTER_CASTS \
	-sFORCE_FILESYSTEM -lidbfs.js -sENVIRONMENT=web
cp web/index.html web/xrogue.js port/tiles.png port/tiles-dawn.png "$OUT/"
# sound effects (message text -> Dubtrain samples) and the town music
mkdir -p "$OUT/sound" "$OUT/music"
python3 web/sounds.py "$OUT/sound"
cp ~/Projects/heavenAndHell/files/mods/heavenandhell/music/new_town.ogg "$OUT/music/"
python3 web/make-help.py > "$OUT/help.html"
ls -la "$OUT"
