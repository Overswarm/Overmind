#!/usr/bin/env bash
# Build the screp-backed WASM module and copy the Go runtime shim into public/.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT_DIR="$ROOT/public/wasm"

mkdir -p "$OUT_DIR"

GOROOT="$(go env GOROOT)"
WASM_EXEC_JS=""
for candidate in \
  "$GOROOT/lib/wasm/wasm_exec.js" \
  "$GOROOT/misc/wasm/wasm_exec.js"; do
  if [ -f "$candidate" ]; then
    WASM_EXEC_JS="$candidate"
    break
  fi
done

if [ -z "$WASM_EXEC_JS" ]; then
  echo "Could not locate wasm_exec.js under $GOROOT" >&2
  exit 1
fi

cp "$WASM_EXEC_JS" "$OUT_DIR/wasm_exec.js"

cd "$HERE"
GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o "$OUT_DIR/screp.wasm" .

echo "Wrote $OUT_DIR/screp.wasm and $OUT_DIR/wasm_exec.js"
