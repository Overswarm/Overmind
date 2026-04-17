# Overmind

Local-first StarCraft: Brood War (Remaster) replay analyzer, designed to run
entirely in the browser. Replays are parsed client-side via a WebAssembly build
of [icza/screp](https://github.com/icza/screp), cached in IndexedDB, and
analyzed without ever leaving your machine.

## Status

**Phase 0 — foundation complete.** Parser, worker, cache, ingest pipeline, and
app shell are wired up. Analytical panels are placeholders.

## Stack

- Vite + React + TypeScript
- Tailwind CSS v4 (`@tailwindcss/vite`)
- Zustand for app state
- Dexie (IndexedDB) for parsed-replay cache + library index
- uPlot for dense time-series charts (used in later phases)
- Go → WebAssembly parser based on icza/screp

## Project layout

```
wasm/           Go source wrapping screp; build.sh compiles to public/wasm/
public/wasm/    screp.wasm + wasm_exec.js (built artifacts, not hand-edited)
src/parser/     Worker + main-thread client + wire protocol
src/storage/    Dexie schema and file ingest pipeline
src/state/      Zustand store (active replay, current frame, UI flags)
src/types/      TypeScript projection of screp's JSON output
src/ui/         App shell, library sidebar, metadata header, timeline, panels
src/analysis/   (Phase 1+) derived metrics
```

## Prerequisites

- Node.js 22+
- Go 1.22+ (only needed to rebuild the WASM parser)

## Run

Double-click `run.bat` (Windows) or `./run.sh` (macOS/Linux). The launcher
installs dependencies on first run, starts the dev server, and opens the app
in your default browser.

From the terminal directly:
```
npm install   # first time only
npm start     # or: npm run dev
```

## Update

To pull the latest code and refresh dependencies, run `update.bat` (Windows) or
`./update.sh` (macOS/Linux). Then start the app as normal.

Drop `.rep` files or a folder onto the main panel. Parsed replays are cached
by SHA-256 of their bytes, so re-opening is instant.

To rebuild the WASM parser (only needed when `wasm/main.go` changes):
```
npm run build:wasm
```

## Build

```
npm run build
npm run preview
```

The production bundle is served from `dist/`. The WASM binary (~4 MB, ~1 MB
gzipped) is loaded on demand when the first replay is opened.

## Roadmap

- **Phase 1** — scrubbable timeline + keyboard controls, dual-track worker /
  army / income graph, build order with export, chat log, leave/disconnect
  detection.
- **Phase 2** — live unit & building roster, inferred worker survival, APM vs
  EAPM with redundancy %, swing markers, opening classifier.
- **Phase 3** — camera & command heatmap, shareable view-state URL, library
  filters & search, PWA + offline, perf pass.
